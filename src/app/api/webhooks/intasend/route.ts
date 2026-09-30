import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow, rowToCamel } from "@/lib/supabase/case";
import { verifyIntasendChallenge } from "@/lib/intasend/client";
import { nextPeriodEnd } from "@/lib/billing/plans";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Single webhook endpoint for both IntaSend payment surfaces in this app:
 *   - kind: "subscription"  -> platform billing (org -> SimbaPOS)
 *   - kind: "pos_payment"   -> guest bill collection (M-Pesa STK / card)
 *
 * The lookup record created at checkout time (intasend_checkouts/{api_ref})
 * tells us which. Idempotent on invoice_id so a redelivered webhook (IntaSend,
 * like most gateways, may retry) never double-applies a payment.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(`intasend-webhook:${ip}`, 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isValid = verifyIntasendChallenge(payload.challenge, timingSafeEqual);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid challenge" }, { status: 401 });
  }

  const invoiceId: string | undefined = payload.invoice_id;
  const apiRef: string | undefined = payload.api_ref;
  const state: string | undefined = payload.state; // COMPLETE | FAILED | PENDING...

  if (!invoiceId || !apiRef) {
    return NextResponse.json({ error: "Missing invoice_id/api_ref" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Idempotency guard: if this exact invoice_id was already processed to a
  // terminal state, acknowledge without reapplying side effects.
  const { data: processedRow, error: processedError } = await db
    .from("processed_webhooks")
    .select("*")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (processedError) {
    return NextResponse.json({ error: "Failed to check idempotency" }, { status: 500 });
  }
  if (processedRow?.terminal) {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  const { data: lookupRow, error: lookupError } = await db
    .from("intasend_checkouts")
    .select("*")
    .eq("api_ref", apiRef)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: "Failed to look up api_ref" }, { status: 500 });
  }
  if (!lookupRow) {
    return NextResponse.json({ error: "Unknown api_ref" }, { status: 404 });
  }
  const lookup = rowToCamel<{
    orgId: string;
    tier?: string;
    kind: "subscription" | "pos_payment";
    orderId?: string;
    stationId?: string;
    tableId?: string;
    createdByUid?: string;
    amountKes?: number;
    phone?: string;
    channel?: "mpesa_stk" | "card";
  }>(lookupRow);

  const isComplete = state === "COMPLETE";
  const isTerminal = state === "COMPLETE" || state === "FAILED" || state === "CANCELLED";

  if (lookup.kind === "subscription") {
    const { error: statusError } = await db
      .from("intasend_checkouts")
      .update(camelToRow({ status: state ?? "unknown" }))
      .eq("api_ref", apiRef);
    if (statusError) {
      return NextResponse.json({ error: "Failed to update checkout status" }, { status: 500 });
    }
    if (isComplete) {
      const { error: orgError } = await db
        .from("organizations")
        .update(
          camelToRow({
            planTier: lookup.tier,
            planStatus: "active",
            planCurrentPeriodEndAt: nextPeriodEnd(),
          })
        )
        .eq("id", lookup.orgId);
      if (orgError) {
        return NextResponse.json({ error: "Failed to update organization plan" }, { status: 500 });
      }
      const { error: auditError } = await db.from("audit_log").insert(
        camelToRow({
          orgId: lookup.orgId,
          actorUid: "system:intasend-webhook",
          action: "subscription.payment_completed",
          targetType: "organization",
          targetId: lookup.orgId,
          metadata: { tier: lookup.tier, invoiceId },
          createdAt: Date.now(),
        })
      );
      if (auditError) {
        console.error("Failed to write audit log entry", auditError);
      }
    }
  } else if (lookup.kind === "pos_payment") {
    const { error: paymentError } = await db.from("payments").upsert(
      camelToRow({
        id: apiRef,
        status: isComplete ? "completed" : state === "FAILED" ? "failed" : "processing",
        intasendInvoiceId: invoiceId,
        intasendState: state ?? "unknown",
        updatedAt: Date.now(),
      })
    );
    if (paymentError) {
      return NextResponse.json({ error: "Failed to update payment" }, { status: 500 });
    }
    if (isComplete && lookup.orderId) {
      const { error: orderError } = await db
        .from("orders")
        .update(camelToRow({ status: "served", updatedAt: Date.now() }))
        .eq("id", lookup.orderId);
      if (orderError) {
        console.error("Failed to update order status", orderError);
      }
      if (lookup.tableId) {
        const { error: tableError } = await db
          .from("tables")
          .update(camelToRow({ status: "settled" }))
          .eq("id", lookup.tableId);
        if (tableError) {
          console.error("Failed to update table status", tableError);
        }
      }
    }
  }

  if (isTerminal) {
    const { error: terminalError } = await db.from("processed_webhooks").upsert(
      camelToRow({ invoiceId, terminal: true, processedAt: Date.now() })
    );
    if (terminalError) {
      console.error("Failed to record processed webhook", terminalError);
    }
  }

  return NextResponse.json({ ok: true });
}

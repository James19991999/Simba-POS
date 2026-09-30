import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow, rowToCamel } from "@/lib/supabase/case";
import { verifySession, requireOrgRole, UnauthorizedError, ForbiddenError } from "@/lib/auth/verifySession";
import { getIntasendInvoiceStatus } from "@/lib/intasend/client";
import type { Payment } from "@/types";

/**
 * Backs the "Awaiting Customer PIN Entry..." live tracker in the Waiter POS
 * screen — polled every few seconds while a resend/force-confirm is
 * available, and also updated authoritatively by the webhook. Polling here
 * is a UX convenience (fast feedback); the webhook remains the source of
 * truth for actually marking the order settled.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    const { searchParams } = new URL(req.url);
    const apiRef = searchParams.get("apiRef");
    const orgId = searchParams.get("orgId");
    if (!apiRef || !orgId) {
      return NextResponse.json({ error: "apiRef and orgId are required" }, { status: 400 });
    }

    await requireOrgRole(session.uid, orgId, [
      "owner",
      "manager",
      "floor_captain",
      "waiter",
      "accountant",
    ]);

    const db = supabaseAdmin();
    const { data, error } = await db.from("payments").select("*").eq("id", apiRef).maybeSingle();
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    const payment = rowToCamel<Payment>(data);
    if (payment.orgId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Best-effort live refresh from IntaSend directly (in case the webhook
    // hasn't landed yet); failures here fall back to the last known stored
    // state rather than surfacing a hard error to the waiter mid-checkout.
    // Only meaningful for M-Pesa STK (Collection API), which returns an
    // invoice_id immediately — a card payment via hosted Checkout has no
    // invoice_id until the customer completes it, so that path is entirely
    // webhook-driven and this block is a no-op for it.
    if ((payment.status === "pending" || payment.status === "processing") && payment.intasendInvoiceId) {
      try {
        const live = await getIntasendInvoiceStatus(payment.intasendInvoiceId);
        const state = live.invoice.state;
        const mapped =
          state === "COMPLETE" ? "completed" : state === "FAILED" ? "failed" : "processing";
        if (mapped !== payment.status) {
          await db
            .from("payments")
            .update(camelToRow({ status: mapped, intasendState: state, updatedAt: Date.now() }))
            .eq("id", apiRef);
          payment.status = mapped;
          payment.intasendState = state;
        }
      } catch {
        // ignore — fall back to stored state
      }
    }

    return NextResponse.json({ status: payment.status, intasendState: payment.intasendState ?? null });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

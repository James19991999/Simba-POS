import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow } from "@/lib/supabase/case";
import { verifySession, requireOrgRole, UnauthorizedError, ForbiddenError } from "@/lib/auth/verifySession";
import { triggerMpesaStkPush, createIntasendCheckout } from "@/lib/intasend/client";
import { rateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  orgId: z.string().min(1),
  stationId: z.string().min(1),
  orderId: z.string().min(1),
  tableId: z.string().optional(),
  amountKes: z.number().positive(),
  channel: z.enum(["mpesa_stk", "card"]),
  phone: z.string().optional(), // required for mpesa_stk
  customerName: z.string().optional(),
  customerEmail: z.string().optional(),
});

/**
 * Replaces the export's separate "M-Pesa Daraja direct" and "Pesapal/KCB
 * card" integrations with IntaSend for both — but IntaSend exposes these as
 * two DIFFERENT APIs, not one unified call (see lib/intasend/client.ts):
 *   - mpesa_stk -> direct Collection API push (no redirect, matches the
 *     "Awaiting Customer PIN Entry" tracker already built)
 *   - card -> Express Checkout hosted URL (the waiter/guest opens `url` to
 *     enter card details; settlement is webhook-driven since no invoice_id
 *     exists until the customer actually completes it)
 * Any shift-scoped staff role (waiter and above) may trigger a guest's bill
 * payment, unlike platform billing which is owner-only.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);

    const rl = await rateLimit(`pos-checkout:${session.uid}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 60) } }
      );
    }

    const json = await req.json();
    const body = bodySchema.parse(json);

    if (body.channel === "mpesa_stk" && !body.phone) {
      return NextResponse.json({ error: "phone is required for M-Pesa STK" }, { status: 400 });
    }

    await requireOrgRole(session.uid, body.orgId, [
      "owner",
      "manager",
      "floor_captain",
      "waiter",
      "accountant",
    ]);

    const apiRef = `simbapos-pos-${body.orderId}-${Date.now()}`;
    const db = supabaseAdmin();
    const guestName = body.customerName?.trim() || "Guest";
    const guestEmail = body.customerEmail?.trim() || "guest@simbapos.local";

    let intasendInvoiceId: string | null = null;
    let intasendState = "PENDING";
    let checkoutUrl: string | null = null;

    if (body.channel === "mpesa_stk") {
      const push = await triggerMpesaStkPush({
        amount: body.amountKes,
        currency: "KES",
        api_ref: apiRef,
        name: guestName,
        email: guestEmail,
        phone_number: body.phone!,
      });
      intasendInvoiceId = push.invoice.invoice_id;
      intasendState = push.invoice.state;
    } else {
      const [firstName, ...rest] = guestName.split(" ");
      const checkout = await createIntasendCheckout({
        amount: body.amountKes,
        currency: "KES",
        email: guestEmail,
        first_name: firstName || "Guest",
        last_name: rest.join(" ") || "Guest",
        country: "KE",
        phone_number: body.phone,
        api_ref: apiRef,
      });
      checkoutUrl = checkout.url;
      // No invoice_id exists yet for a hosted checkout until the customer
      // completes it — settlement here is entirely webhook-driven.
    }

    const { error: checkoutError } = await db.from("intasend_checkouts").upsert(
      camelToRow({
        apiRef,
        orgId: body.orgId,
        kind: "pos_payment",
        stationId: body.stationId,
        orderId: body.orderId,
        tableId: body.tableId ?? null,
        amountKes: body.amountKes,
        phone: body.phone ?? null,
        channel: body.channel,
        createdByUid: session.uid,
        createdAt: Date.now(),
      })
    );
    if (checkoutError) {
      console.error(checkoutError);
      return NextResponse.json({ error: "Failed to record checkout" }, { status: 500 });
    }

    const { error: paymentError } = await db.from("payments").upsert(
      camelToRow({
        id: apiRef,
        orgId: body.orgId,
        stationId: body.stationId,
        orderId: body.orderId,
        tableId: body.tableId ?? null,
        channel: body.channel,
        status: "pending",
        amountKes: body.amountKes,
        phone: body.phone ?? null,
        intasendInvoiceId,
        intasendState,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdByUid: session.uid,
      })
    );
    if (paymentError) {
      console.error(paymentError);
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
    }

    return NextResponse.json({ apiRef, invoiceId: intasendInvoiceId, url: checkoutUrl });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

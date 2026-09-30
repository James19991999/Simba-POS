import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow, rowToCamel } from "@/lib/supabase/case";
import { verifyHmacSignature } from "@/lib/aggregators/verify";
import { rateLimit } from "@/lib/rate-limit";
import type { Order, OrderChannel, OrderLineItem } from "@/types";

const CHANNEL_MAP: Record<string, OrderChannel> = {
  glovo: "glovo",
  "uber-eats": "uber_eats",
  jumia: "jumia",
};

const lineItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceKes: z.number().nonnegative(),
});

const payloadSchema = z.object({
  orgId: z.string().min(1),
  stationId: z.string().min(1),
  externalOrderId: z.string().min(1),
  items: z.array(lineItemSchema).min(1),
  totalKes: z.number().positive(),
});

/**
 * Real inbound webhook receiver for delivery aggregators — replaces the
 * Delivery Hub's earlier "+ Glovo / + Uber Eats / + Jumia" manual buttons
 * (which just created a fake demo order) with an actual receiving endpoint
 * that verifies a signature and upserts a real Order document, idempotent
 * on externalOrderId so a redelivered webhook doesn't create a duplicate
 * ticket.
 *
 * What's genuinely closeable from this sandbox vs. not: the verification
 * mechanism, idempotency, and Firestore upsert here are real and tested.
 * What ISN'T closeable without a real partner account with each aggregator:
 * the actual payload shape and signing scheme are per-platform and only
 * disclosed to approved partners — see lib/aggregators/verify.ts's comment.
 * Registering this URL with a real Glovo/Uber Eats/Jumia integration and
 * confirming their exact payload/signature format is the remaining step.
 */
export async function POST(req: NextRequest, { params }: { params: { channel: string } }) {
  const channel = CHANNEL_MAP[params.channel];
  if (!channel) {
    return NextResponse.json({ error: `Unknown aggregator channel: ${params.channel}` }, { status: 404 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(`aggregator-webhook:${params.channel}:${ip}`, 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const rawBody = await req.text();
  const secretEnvKey = `AGGREGATOR_WEBHOOK_SECRET_${params.channel.toUpperCase().replace(/-/g, "_")}`;
  const secret = process.env[secretEnvKey];
  const signature = req.headers.get("x-webhook-signature");

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const db = supabaseAdmin();
  // Idempotent on externalOrderId: a redelivered webhook updates the same
  // order row rather than creating a duplicate kitchen ticket.
  const { data: existingRows, error: existingError } = await db
    .from("orders")
    .select("*")
    .eq("org_id", body.orgId)
    .eq("external_ref", body.externalOrderId)
    .limit(1);

  if (existingError) {
    return NextResponse.json({ error: "Failed to check for existing order" }, { status: 500 });
  }

  const items: OrderLineItem[] = body.items.map((i, idx) => ({
    id: `${body.externalOrderId}-${idx}`,
    menuItemId: "aggregator-manual",
    nameEn: i.name,
    qty: i.quantity,
    unitPriceKes: i.unitPriceKes,
  }));

  const existingRow = existingRows?.[0];
  if (existingRow) {
    const { error: updateError } = await db
      .from("orders")
      .update(camelToRow({ items, totalKes: body.totalKes, updatedAt: Date.now() }))
      .eq("id", existingRow.id);
    if (updateError) {
      return NextResponse.json({ error: "Failed to update existing order" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, orderId: existingRow.id, updated: true });
  }

  const orderWithoutId: Omit<Order, "id"> = {
    orgId: body.orgId,
    stationId: body.stationId,
    channel,
    status: "incoming",
    items,
    subtotalKes: body.totalKes,
    vatKes: 0,
    tourismLevyKes: 0,
    totalKes: body.totalKes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: "system:aggregator-webhook",
    externalRef: body.externalOrderId,
  };
  const { data: inserted, error: insertError } = await db
    .from("orders")
    .insert(camelToRow(orderWithoutId))
    .select()
    .single();
  if (insertError || !inserted) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
  const newOrder = rowToCamel<Order>(inserted);

  return NextResponse.json({ ok: true, orderId: newOrder.id, updated: false });
}

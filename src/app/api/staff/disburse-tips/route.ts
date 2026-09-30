import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow, rowToCamel, rowsToCamel } from "@/lib/supabase/case";
import { verifySession, requireOrgRole, UnauthorizedError, ForbiddenError } from "@/lib/auth/verifySession";
import { sendMpesaB2C } from "@/lib/intasend/client";
import { rateLimit } from "@/lib/rate-limit";
import type { Membership, ShiftCheckIn, TipPoolEntry } from "@/types";

const bodySchema = z.object({
  orgId: z.string().min(1),
  tipPoolEntryId: z.string().min(1),
});

/**
 * Real M-Pesa B2C tip disbursement (replaces the earlier Firestore-only
 * "mark as disbursed" stub). Manager/owner-gated. Pays each currently
 * checked-in crew member their equal share via IntaSend's Send Money API.
 *
 * Crew members with no phone number on file (see Membership.phone) are
 * skipped and reported back rather than silently dropped or blocking the
 * whole disbursement — a real restaurant's roster will not have everyone's
 * M-Pesa number entered on day one.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);

    const rl = await rateLimit(`disburse-tips:${session.uid}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 60) } }
      );
    }

    const { orgId, tipPoolEntryId } = bodySchema.parse(await req.json());
    await requireOrgRole(session.uid, orgId, ["owner", "manager"]);

    const db = supabaseAdmin();
    const { data: tipRow, error: tipError } = await db
      .from("tip_pool_entries")
      .select("*")
      .eq("id", tipPoolEntryId)
      .maybeSingle();
    if (tipError) throw tipError;
    if (!tipRow) {
      return NextResponse.json({ error: "Tip pool entry not found" }, { status: 404 });
    }
    const tipEntry = rowToCamel<TipPoolEntry>(tipRow);
    if (tipEntry.orgId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (tipEntry.disbursed) {
      return NextResponse.json({ error: "Already disbursed" }, { status: 409 });
    }

    const { data: checkInRows, error: checkInsError } = await db
      .from("shift_check_ins")
      .select("*")
      .eq("org_id", orgId)
      .eq("shift_id", tipEntry.shiftId);
    if (checkInsError) throw checkInsError;
    const checkIns = rowsToCamel<ShiftCheckIn>(checkInRows ?? []);
    const uniqueUserIds = Array.from(new Set(checkIns.map((c) => c.userId)));

    const { data: membershipRows, error: membershipsError } = await db
      .from("memberships")
      .select("*")
      .eq("org_id", orgId)
      .in("user_id", uniqueUserIds);
    if (membershipsError) throw membershipsError;
    const members = rowsToCamel<Membership>(membershipRows ?? []);

    const payable = members.filter((m) => !!m.phone);
    const skipped = members.filter((m) => !m.phone);

    if (payable.length === 0) {
      const message = "No checked-in crew member has a phone number on file. Add phone numbers in Settings > Team before disbursing.";
      const { error: updateError } = await db
        .from("tip_pool_entries")
        .update(camelToRow({ disbursementError: message }))
        .eq("id", tipPoolEntryId);
      if (updateError) throw updateError;
      return NextResponse.json({ error: message, skipped: skipped.map((m) => m.displayName) }, { status: 422 });
    }

    const b2c = await sendMpesaB2C({
      currency: "KES",
      transactions: payable.map((m) => ({
        name: m.displayName,
        account: m.phone!,
        amount: tipEntry.perHeadKes,
        narrative: "SimbaPOS tip pool disbursement",
      })),
    });

    const { error: disburseError } = await db
      .from("tip_pool_entries")
      .update(camelToRow({
        disbursed: true,
        disbursedAt: Date.now(),
        intasendTrackingId: b2c.tracking_id,
        disbursementResults: payable.map((m, i) => ({
          userId: m.userId,
          displayName: m.displayName,
          account: m.phone!,
          status: b2c.transactions[i]?.status ?? "SUBMITTED",
        })),
        disbursementError:
          skipped.length > 0
            ? `${skipped.length} crew member(s) skipped for missing phone: ${skipped.map((m) => m.displayName).join(", ")}`
            : null,
      }))
      .eq("id", tipPoolEntryId);
    if (disburseError) throw disburseError;

    const { error: auditError } = await db.from("audit_log").insert(camelToRow({
      orgId,
      actorUid: session.uid,
      action: "staff.tip_pool_disbursed",
      targetType: "tipPoolEntry",
      targetId: tipPoolEntryId,
      metadata: { trackingId: b2c.tracking_id, payableCount: payable.length, skippedCount: skipped.length },
      createdAt: Date.now(),
    }));
    if (auditError) throw auditError;

    return NextResponse.json({ ok: true, trackingId: b2c.tracking_id, paid: payable.length, skipped: skipped.length });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

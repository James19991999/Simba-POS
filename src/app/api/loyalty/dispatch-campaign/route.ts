import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow, rowsToCamel } from "@/lib/supabase/case";
import { verifySession, requireOrgRole, UnauthorizedError, ForbiddenError } from "@/lib/auth/verifySession";
import { sendBulkSms, SmsNotConfiguredError } from "@/lib/sms/africastalking";
import { rateLimit } from "@/lib/rate-limit";
import type { LoyaltyMember } from "@/types";

const bodySchema = z.object({
  orgId: z.string().min(1),
  campaignId: z.string().min(1),
});

/**
 * Real SMS dispatch (replaces the earlier "mark campaign as sent" stub).
 * Sends to every enrolled Zawadi Network member's phone number via Africa's
 * Talking. Batches in groups of 100 (that API's practical per-request limit
 * for the `to` field) rather than one call per recipient.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);

    const rl = await rateLimit(`dispatch-campaign:${session.uid}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 60) } }
      );
    }

    const { orgId, campaignId } = bodySchema.parse(await req.json());
    await requireOrgRole(session.uid, orgId, ["owner", "manager"]);

    const db = supabaseAdmin();
    const { data: campaignRow, error: campaignError } = await db
      .from("sms_campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) {
      console.error(campaignError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    if (!campaignRow) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const campaign = campaignRow as { org_id: string; status: string; message: string };
    if (campaign.org_id !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (campaign.status === "sent") {
      return NextResponse.json({ error: "Already sent" }, { status: 409 });
    }

    const { data: memberRows, error: membersError } = await db
      .from("loyalty_members")
      .select("*")
      .eq("org_id", orgId);
    if (membersError) {
      console.error(membersError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    const members = rowsToCamel<LoyaltyMember>(memberRows ?? []);
    const phones = members.map((m) => m.phone).filter(Boolean);

    let totalSent = 0;
    const batches: string[][] = [];
    for (let i = 0; i < phones.length; i += 100) batches.push(phones.slice(i, i + 100));

    for (const batch of batches) {
      const result = await sendBulkSms(batch, campaign.message, "SIMBAPOS");
      totalSent += result.recipients.filter((r) => r.status === "Success").length;
    }

    const { error: updateError } = await db
      .from("sms_campaigns")
      .update(camelToRow({ status: "sent", sentAt: Date.now(), audienceCount: phones.length }))
      .eq("id", campaignId);
    if (updateError) {
      console.error(updateError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const { error: auditError } = await db.from("audit_log").insert(
      camelToRow({
        orgId,
        actorUid: session.uid,
        action: "loyalty.campaign_dispatched",
        targetType: "smsCampaign",
        targetId: campaignId,
        metadata: { audienceCount: phones.length, totalSent },
        createdAt: Date.now(),
      })
    );
    if (auditError) {
      console.error(auditError);
    }

    return NextResponse.json({ ok: true, audienceCount: phones.length, totalSent });
  } catch (err) {
    if (err instanceof SmsNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
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

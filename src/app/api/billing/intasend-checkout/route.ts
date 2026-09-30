import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camelToRow, rowToCamel } from "@/lib/supabase/case";
import { verifySession, requireOrgRole, UnauthorizedError, ForbiddenError } from "@/lib/auth/verifySession";
import { createIntasendCheckout } from "@/lib/intasend/client";
import { PLANS, PlanTier } from "@/lib/billing/plans";
import { rateLimit } from "@/lib/rate-limit";
import type { Membership } from "@/types";

const bodySchema = z.object({
  orgId: z.string().min(1),
  tier: z.enum(["starter", "growth", "enterprise"]),
});

// Owner-gated: only the org owner may change the platform subscription.
export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);

    const rl = await rateLimit(`billing-checkout:${session.uid}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 60) } }
      );
    }

    const json = await req.json();
    const { orgId, tier } = bodySchema.parse(json);

    await requireOrgRole(session.uid, orgId, ["owner"]);

    const plan = PLANS[tier as PlanTier];
    const apiRef = `simbapos-sub-${orgId}-${Date.now()}`;

    // Express Checkout requires first_name/last_name/country — pull the
    // owner's membership record rather than guessing, and split their
    // display name defensively (a single-word name is common in this
    // market and must not crash the checkout).
    const db = supabaseAdmin();
    const { data: membershipRow, error: membershipError } = await db
      .from("memberships")
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", session.uid)
      .maybeSingle();
    if (membershipError) {
      console.error(membershipError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    const membership = membershipRow ? rowToCamel<Membership>(membershipRow) : null;
    const displayName = membership?.displayName || "Owner";
    const [firstName, ...rest] = displayName.split(" ");

    const checkout = await createIntasendCheckout({
      amount: plan.priceKesPerMonth,
      currency: "KES",
      email: session.email ?? "owner@simbapos.local",
      first_name: firstName || "Owner",
      last_name: rest.join(" ") || "SimbaPOS",
      country: "KE",
      api_ref: apiRef,
      redirect_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?status=return`,
    });

    // IntaSend's checkout payload has no metadata field the way Stripe's
    // does, so a short-lived lookup record carries orgId/tier from create
    // through to the webhook, keyed by api_ref (== invoice.api_ref later).
    const { error: checkoutError } = await db.from("intasend_checkouts").upsert(
      camelToRow({
        apiRef,
        orgId,
        tier,
        kind: "subscription",
        createdAt: Date.now(),
        status: "pending",
      })
    );
    if (checkoutError) {
      console.error(checkoutError);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({ url: checkout.url, apiRef });
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

# SimbaPOS

Multi-tenant restaurant management platform for Kenyan/East African hospitality SMEs, built from the "SimbaPOS" Stitch design export. Next.js 14 (App Router) + TypeScript + TailwindCSS + Supabase (Auth/Postgres/Row Level Security) + IntaSend for all payments. **No Stripe anywhere in this codebase**, per the build brief — both platform subscription billing and in-restaurant guest bill collection (M-Pesa STK Push + card) run through IntaSend.

## Setup

1. `npm install`
2. Create a Supabase project (supabase.com, or your own self-hosted instance), then apply the schema: `npx supabase link --project-ref <your-project-ref>` followed by `npx supabase db push` (or paste `supabase/migrations/0001_init.sql` into the SQL editor). This creates every table, RLS policy, and trigger described below, and enables Realtime on all tenant tables.
3. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API)
   - `SUPABASE_SERVICE_ROLE_KEY` (same page — server-side only, never expose client-side; this is the Firebase-Admin-SDK-equivalent trust boundary)
   - An IntaSend **secret key** and **public key** (sandbox or live) and a webhook challenge string (set the same value in the IntaSend dashboard's webhook config)
   - Optionally: `AFRICASTALKING_API_KEY`/`AFRICASTALKING_USERNAME` for real SMS loyalty campaigns, and one `AGGREGATOR_WEBHOOK_SECRET_*` per delivery aggregator you integrate
4. `npm run dev` for local development, `npm run build && npm start` for production, or deploy to Vercel.

For local Postgres development against Docker instead of a hosted project, `supabase/config.toml` is already scaffolded — run `npx supabase start` (requires Docker running locally) and point `.env.local` at the printed local URL/keys instead.

## Scripts

- `npm run dev` / `npm run build` / `npm start`
- `npm run lint`
- `npx jest` — unit tests (54 tests: billing/tax, loyalty tiers, rate limiting, currency formatting, IntaSend endpoint shapes + webhook challenge verification, Africa's Talking SMS client, KOT/receipt HTML generation, aggregator webhook signature verification + idempotency)
- `npx tsc --noEmit` — typecheck

## Architecture

- **Multi-tenancy**: every business record carries an `org_id`; `memberships` rows carry the caller's role (a real uuid primary key, unique on `(org_id, user_id)`). Postgres Row Level Security policies (`supabase/migrations/0001_init.sql`) re-derive membership/role server-side on every query, via `SECURITY DEFINER` helper functions (`is_org_member`, `has_org_role`) that avoid the classic "RLS policy on `memberships` recursively queries `memberships`" trap — this is the real tenant-isolation boundary, not the client-side route guards in `AppShell`/`RoleGate`. Two `BEFORE UPDATE` triggers (`enforce_membership_update`, `enforce_org_update`) do the field-level restriction that Firestore rules did with `diff().affectedKeys()`: a member can self-update only their own `phone` field (needed for real M-Pesa B2C tip payout) without touching their own role/active status, and `owner_uid`/plan fields on `organizations` can only be changed by the service role (IntaSend checkout/webhook), never by a client. Live updates use Supabase Realtime (`postgres_changes`) — the direct equivalent of Firestore's `onSnapshot`.
- **Roles**: owner, manager, floor_captain, waiter, kitchen, rider, accountant (`src/types/index.ts`).
- **Payments**: `src/lib/intasend/client.ts` is a direct-fetch IntaSend client (deliberately not the community `intasend-node` package, to keep the payment path auditable). Its endpoint shapes were re-verified against IntaSend's own docs during this build — an earlier draft had incorrectly collapsed three distinct IntaSend APIs into one call; this is now split correctly:
  - `POST /payment/collection/` — direct M-Pesa STK push (no redirect)
  - `POST /checkout/` — Express Checkout hosted URL, used for card payments and platform billing
  - `POST /payment/status/` — status lookup by `invoice_id`
  - `POST /send-money/initiate/` — M-Pesa B2C, used for real tip-pool disbursement
  - Platform billing: `POST /api/billing/intasend-checkout` (owner-gated) + `POST /api/webhooks/intasend`
  - Guest bill collection: `POST /api/pos/intasend-checkout` (branches to STK push or card checkout) + `GET /api/pos/intasend-status` for live polling, settled authoritatively by the same webhook.
  - The webhook verifies IntaSend's shared "challenge" string with `crypto.timingSafeEqual` — documented in code as structurally weaker than an HMAC signature (and as not fully re-confirmed against IntaSend's current webhook docs, which didn't spell out the mechanism on the pages this build could reach), and idempotent on `invoice_id`.
- **Tax/billing math**: `src/lib/billing/tax.ts` — verified against the Waiter POS screen's own worked example (7,000 subtotal → 140 levy → 965.52 VAT → 7,140 total). A test written against that exact example caught a real bug (VAT was being backed out of the post-levy total instead of the items subtotal); fixed and pinned by regression tests.
- **SMS**: `src/lib/sms/africastalking.ts` — real Africa's Talking client (`POST /version1/messaging`), used by `POST /api/loyalty/dispatch-campaign` to send real bulk SMS to enrolled loyalty members. Fails loudly with a clear "not configured" error if no API key is set, rather than silently pretending to send.
- **Tip payout**: `POST /api/staff/disburse-tips` calls IntaSend's real M-Pesa B2C API (`send-money/initiate/`) to pay each checked-in crew member their equal share directly. Crew without a phone number on file (`Settings > Team`) are skipped and reported, not silently dropped or paid nothing without explanation.
- **Printing**: `src/lib/printing/receipt.ts` generates real KOT and receipt HTML and prints it via the browser's native `window.print()` — this produces an actual print job on whatever printer the OS has configured (including a thermal receipt printer registered as a normal system/CUPS printer), with no proprietary ESC/POS driver needed. Item names are HTML-escaped to prevent injection into the print window.
- **Delivery aggregators**: `POST /api/webhooks/aggregator/[channel]` (`glovo` / `uber-eats` / `jumia`) is a real, signature-verified, idempotent webhook receiver that upserts an `orders` row via the service-role Postgres client — see its code comment for what's genuinely closeable here (verification mechanism, idempotency, the upsert itself) vs. what isn't (each aggregator's real payload shape and signing scheme, which are only disclosed to approved partners).
- **KRA eTIMS**: `src/lib/etims/client.ts` simulates VSCU transmission and marks every generated invoice `simulated: true` — see Gap Analysis below. This one could not be moved closer to real without an actual KRA-issued device certificate, which no sandbox can obtain.

## Gap analysis — what's real, what's simulated, what's a deliberate scope call

Read this before telling anyone this build is "100% done" in the sense of "verified against live third-party services." It is complete in the sense of: every screen in the Stitch export is a real, data-backed route; every documented business rule (tax math, loyalty tiers, bill splitting, RBAC) is implemented and unit-tested; every payment/messaging/printing surface calls a real, correctly-shaped external API rather than a database-only stub; the app builds clean (0 TS/ESLint errors) and the full test suite passes (54/54).

**Fully real, wired to live data:**
- All 11 module screens read/write real Postgres rows via Supabase, scoped by org, with live `postgres_changes` (Realtime) updates.
- Postgres Row Level Security policies + `BEFORE UPDATE` triggers enforce real tenant isolation and field-level write restrictions (see Architecture above).
- Sign-up, sign-in, onboarding are real Supabase Auth + Postgres writes.
- Tax/VAT/levy math, bill splitting, and loyalty point/tier math are unit-tested pure functions pinned to the Stitch export's own worked examples (one real calculation bug caught and fixed this way) — this layer is backend-agnostic and was untouched by the Firebase-to-Supabase migration.
- IntaSend checkout/status/webhook/B2C payout routes call the correctly-shaped real IntaSend APIs (re-verified against IntaSend's docs, not assumed).
- Africa's Talking SMS dispatch calls the real API with the correct endpoint/headers/body.
- The aggregator webhook receiver does real HMAC verification and a real idempotent Postgres upsert.
- KOT/receipt printing produces a real OS print job via `window.print()`.
- Rate limiting is real (in-memory, Upstash Redis upgrade path wired in).
- The full TypeScript build (`tsc --noEmit`), ESLint, and Jest suite (54/54) all pass clean against the migrated Supabase codebase.

**Structurally real but unverified against a live third party** (needs real credentials/accounts/infrastructure that don't exist in a build sandbox — confirmed by actually trying, not assumed):
- A live Supabase Auth/Postgres round-trip against an actual project — this sandbox has no outbound access to provision or reach one. `npx supabase start` (the local Docker-backed stack) was also attempted here and failed with a confirmed error connecting to the Docker daemon (`dial unix /var/run/docker.sock: ... no such file or directory`; starting `dockerd` directly failed too, on `ulimit`/no-systemd sandbox restrictions) — the same class of infrastructure restriction that blocked the Firebase emulator suite in the prior version of this build. The schema/RLS/triggers in `supabase/migrations/0001_init.sql` are code-reviewed and internally consistent (correct helper-function recursion avoidance, correct trigger logic) but not yet exercised against a running Postgres instance.
- A live IntaSend checkout/STK-push/B2C round-trip.
- A live Africa's Talking SMS send.
- A live aggregator webhook delivery from a real Glovo/Uber Eats/Jumia partner account — the receiver's mechanics are real, but no such account exists here to register the URL with.
- IntaSend's webhook challenge-verification mechanism specifically — the scheme implemented follows the pattern from prior IntaSend integrations, but this build's attempt to re-confirm it against IntaSend's current public docs came up empty (the relevant pages didn't spell out the mechanism); verify it against your actual IntaSend dashboard webhook config before relying on it.

**Explicitly simulated, not faked as real:**
- KRA eTIMS/VSCU transmission (`lib/etims/client.ts`) — every invoice is marked `simulated: true`. Real transmission needs a KRA-issued device certificate and either live VSCU/OSCU hardware or a KRA sandbox account — a legal/administrative process, not a coding task, and the one gap in this build that categorically cannot be closed from any sandbox.

**Deliberate scope calls, not oversights:**
- IntaSend's Checkout API is one-time, not recurring — platform billing has an explicit renewal flow instead of assumed auto-renewal.
- Font: Plus Jakarta Sans falls back to a system stack rather than `next/font/google`, because this sandbox cannot reach Google Fonts' host.
- Hardware pairing (KOT/bar printers as network devices, card PDQ terminal, the "Hybrid Offline Node" LAN fallback) is represented in the Settings data model but not implemented as real device/network communication — browser printing (above) covers the actual printing need without requiring this.
- Each aggregator's exact webhook payload shape and signing scheme (as opposed to the receiver mechanics, which are real) can only be confirmed against a real partner account.

**What would need to happen before a real restaurant relies on this in production:**
1. Provision a real Supabase project, run `npx supabase db push` (or paste `0001_init.sql` into the SQL editor) to apply the schema/RLS/triggers, and run through sign-up → onboarding → order → payment end-to-end against it — including confirming the RLS policies and triggers behave as designed under a real authenticated session (not just code review).
2. Get a real IntaSend account (sandbox first) and verify a real M-Pesa STK push, card checkout, and B2C payout round-trip, including the webhook actually arriving and being verified against your dashboard's actual challenge/signature config.
3. Get a real Africa's Talking (or equivalent) account and confirm a live SMS send.
4. Register the aggregator webhook URLs with real Glovo/Uber Eats/Jumia partner accounts once you have them, and adjust `lib/aggregators/verify.ts` if their actual signing scheme differs from the HMAC-SHA256 default implemented here.
5. Engage KRA's eTIMS onboarding process for a real device certificate — required by law for a VAT-registered Kenyan restaurant, and the one item on this list that isn't primarily an engineering task.
6. Load-test the rate limiter under real concurrent traffic and decide whether Upstash Redis is needed for a multi-instance deploy.
7. Consider wrapping the three-insert onboarding flow (`createOrganizationAndOwner` in `src/lib/auth/actions.ts`) in a single Postgres RPC function (`SECURITY DEFINER`, one transaction) — the current client-side sequential-insert version is correct for the common case but isn't atomic the way the old single-batch Firestore write was; a partial failure between inserts leaves an orphaned `organizations`/`stations` row.

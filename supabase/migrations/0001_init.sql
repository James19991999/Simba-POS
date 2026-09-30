-- SimbaPOS — initial Postgres schema + Row Level Security policies.
--
-- This replaces the earlier Firestore data model + firestore.rules 1:1 in
-- intent: every table below carries an org_id (tenant scoping), and RLS
-- policies re-derive the caller's membership/role SERVER-SIDE from the
-- `memberships` table on every query — this is the real tenant-isolation
-- boundary, exactly as firestore.rules was for the Firebase version, not
-- the client-side route guards in the Next.js app.
--
-- Two Postgres-native mechanisms replace what Firestore rules did with
-- request.resource.data.diff().affectedKeys():
--   1. BEFORE UPDATE triggers (enforce_membership_update / enforce_org_update)
--      reject specific field changes (role/active, plan/owner_uid) unless
--      the caller is authorized OR the call is running as service_role
--      (i.e. from a trusted server-side API route using the service key).
--   2. A SECURITY DEFINER helper function (is_org_member / has_org_role)
--      queries `memberships` with the *function owner's* privileges, which
--      is what avoids the classic "RLS policy on memberships recursively
--      queries memberships" infinite-recursion trap.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.active = true
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.active = true
      and m.role = any(p_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_uid uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  vat_rate numeric not null default 0.16,
  tourism_levy_rate numeric not null default 0.02,
  rounding_kes numeric not null default 1,
  kra_pin text not null default '',
  kra_vscu_device_id text not null default '',
  kra_connected boolean not null default false,
  intasend_publishable_key text,
  intasend_till_or_paybill text,
  plan_tier text not null default 'starter' check (plan_tier in ('starter', 'growth', 'enterprise')),
  plan_status text not null default 'trialing' check (plan_status in ('trialing', 'active', 'past_due', 'canceled')),
  plan_current_period_end_at timestamptz,
  locale_default text not null default 'en' check (locale_default in ('en', 'sw'))
);

alter table public.organizations enable row level security;

create or replace function public.enforce_org_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.owner_uid is distinct from old.owner_uid
     or new.plan_tier is distinct from old.plan_tier
     or new.plan_status is distinct from old.plan_status
     or new.plan_current_period_end_at is distinct from old.plan_current_period_end_at then
    raise exception 'owner_uid and plan fields can only be changed by the server (IntaSend checkout/webhook)';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_org_update
  before update on public.organizations
  for each row execute function public.enforce_org_update();

create policy "org: members can read" on public.organizations
  for select using (public.is_org_member(id));

create policy "org: owner can create" on public.organizations
  for insert with check (owner_uid = auth.uid());

create policy "org: owner/manager can update" on public.organizations
  for update using (public.has_org_role(id, array['owner', 'manager']))
  with check (public.has_org_role(id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'floor_captain', 'waiter', 'kitchen', 'rider', 'accountant')),
  display_name text not null,
  email text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table public.memberships enable row level security;

create or replace function public.enforce_membership_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if auth.uid() = old.user_id then
      raise exception 'cannot change your own role or active status';
    end if;
    if not public.has_org_role(old.org_id, array['owner', 'manager']) then
      raise exception 'only an owner or manager can change role/active';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_membership_update
  before update on public.memberships
  for each row execute function public.enforce_membership_update();

create policy "membership: readable by self or org owner/manager" on public.memberships
  for select using (
    user_id = auth.uid() or public.has_org_role(org_id, array['owner', 'manager'])
  );

create policy "membership: self-insert (onboarding) or owner/manager invite" on public.memberships
  for insert with check (
    user_id = auth.uid() or public.has_org_role(org_id, array['owner', 'manager'])
  );

-- Field-level enforcement is the trigger above; this policy just gates who
-- may attempt an update at all (self, or an owner/manager of the org).
create policy "membership: self or owner/manager can update" on public.memberships
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, array['owner', 'manager'])
  ) with check (
    user_id = auth.uid() or public.has_org_role(org_id, array['owner', 'manager'])
  );

create policy "membership: owner/manager can remove others" on public.memberships
  for delete using (
    user_id <> auth.uid() and public.has_org_role(org_id, array['owner', 'manager'])
  );

-- ---------------------------------------------------------------------------
-- stations
-- ---------------------------------------------------------------------------

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text not null default '',
  zones text[] not null default array['Indoor Dining', 'Verandah / Terrace', 'Nyama Choma Garden'],
  created_at timestamptz not null default now()
);

alter table public.stations enable row level security;

create policy "stations: members read" on public.stations for select using (public.is_org_member(org_id));
create policy "stations: owner/manager write" on public.stations for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- tables (restaurant floor tables)
-- ---------------------------------------------------------------------------

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  code text not null,
  zone text not null,
  seats int not null default 4,
  status text not null default 'available' check (status in
    ('available', 'seated', 'ordered', 'bill_requested', 'settled', 'cleaning', 'reserved')),
  waiter_uid uuid references auth.users(id),
  waiter_name text,
  seated_at timestamptz,
  pax int,
  active_order_id uuid
);

alter table public.tables enable row level security;

create policy "tables: members read" on public.tables for select using (public.is_org_member(org_id));
create policy "tables: owner/manager create/delete" on public.tables for insert
  with check (public.has_org_role(org_id, array['owner', 'manager']));
create policy "tables: owner/manager delete" on public.tables for delete
  using (public.has_org_role(org_id, array['owner', 'manager']));
create policy "tables: floor staff update" on public.tables for update
  using (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']))
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']));

-- ---------------------------------------------------------------------------
-- waitlist
-- ---------------------------------------------------------------------------

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  name text not null,
  phone text not null,
  pax int not null,
  preference text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  seated boolean not null default false
);

alter table public.waitlist enable row level security;

create policy "waitlist: members read" on public.waitlist for select using (public.is_org_member(org_id));
create policy "waitlist: floor staff write" on public.waitlist for all
  using (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']))
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']));

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  category text not null,
  name_en text not null,
  name_sw text,
  description_en text,
  description_sw text,
  price_kes numeric not null,
  stock_qty int,
  is_special boolean not null default false,
  active boolean not null default true,
  modifiers jsonb not null default '[]'::jsonb
);

alter table public.menu_items enable row level security;

create policy "menu: members read" on public.menu_items for select using (public.is_org_member(org_id));
create policy "menu: owner/manager write" on public.menu_items for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- orders (line items kept as JSONB — matches the app's OrderLineItem[] shape
-- exactly, and a ticket's items are always read/written as one unit, so a
-- child table would add join overhead with no real query benefit here)
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  table_id uuid references public.tables(id),
  channel text not null check (channel in ('dine_in', 'takeaway', 'glovo', 'uber_eats', 'jumia', 'simba_riders')),
  status text not null default 'incoming' check (status in
    ('incoming', 'cooking', 'ready', 'en_route', 'delivered', 'served', 'cancelled')),
  items jsonb not null default '[]'::jsonb,
  subtotal_kes numeric not null default 0,
  vat_kes numeric not null default 0,
  tourism_levy_kes numeric not null default 0,
  total_kes numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_uid text, -- text, not uuid: aggregator webhooks write "system:aggregator-webhook" (no authenticated user), mirroring audit_log.actor_uid
  external_ref text,
  rider_uid uuid references auth.users(id),
  handover_pin text
);

alter table public.orders enable row level security;

create policy "orders: members read" on public.orders for select using (public.is_org_member(org_id));
create policy "orders: floor/kitchen create" on public.orders for insert
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter', 'kitchen']));
create policy "orders: floor/kitchen/rider update" on public.orders for update
  using (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter', 'kitchen', 'rider']))
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter', 'kitchen', 'rider']));
create policy "orders: owner/manager delete" on public.orders for delete
  using (public.has_org_role(org_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- payments — never directly client-writable; created/updated only by API
-- routes using the service-role key (checkout + webhook handlers)
-- ---------------------------------------------------------------------------

create table public.payments (
  id text primary key, -- IntaSend api_ref / apiRef, or a generated cash-* id
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  table_id uuid references public.tables(id),
  channel text not null check (channel in ('mpesa_stk', 'card', 'cash')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  amount_kes numeric not null,
  phone text,
  intasend_invoice_id text,
  intasend_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_uid uuid
);

alter table public.payments enable row level security;

create policy "payments: members read" on public.payments for select using (public.is_org_member(org_id));
-- No insert/update/delete policy for authenticated: only the service-role
-- key (Admin SDK equivalent) can write, exactly like the Firestore version.

-- ---------------------------------------------------------------------------
-- intasend_checkouts / processed_webhooks — service-role only, both ways
-- ---------------------------------------------------------------------------

create table public.intasend_checkouts (
  api_ref text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('subscription', 'pos_payment')),
  tier text,
  station_id uuid,
  order_id uuid,
  table_id uuid,
  amount_kes numeric,
  phone text,
  channel text,
  created_by_uid uuid,
  created_at timestamptz not null default now(),
  status text
);

alter table public.intasend_checkouts enable row level security;
-- No policies at all: fully inaccessible to `authenticated`/`anon`, service-role only.

create table public.processed_webhooks (
  invoice_id text primary key,
  terminal boolean not null default false,
  processed_at timestamptz not null default now()
);

alter table public.processed_webhooks enable row level security;
-- No policies: service-role only.

-- ---------------------------------------------------------------------------
-- inventory_items / purchase_orders
-- ---------------------------------------------------------------------------

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  category text not null check (category in
    ('Butchery & Meats', 'Fresh Produce', 'Bar & Beverages', 'Dry Store', 'LPG & Fuel')),
  name text not null,
  supplier text not null default '',
  supplier_etims_pin text,
  unit text not null default 'kg',
  unit_price_kes numeric not null default 0,
  qty_on_hand numeric not null default 0,
  reorder_point numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.inventory_items enable row level security;

create policy "inventory: members read" on public.inventory_items for select using (public.is_org_member(org_id));
create policy "inventory: owner/manager write" on public.inventory_items for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  qty numeric not null,
  status text not null default 'pending' check (status in ('pending', 'in_transit', 'received', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by_uid uuid
);

alter table public.purchase_orders enable row level security;

create policy "po: members read" on public.purchase_orders for select using (public.is_org_member(org_id));
create policy "po: owner/manager write" on public.purchase_orders for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- shifts / shift_check_ins / tip_pool_entries / leave_requests
-- ---------------------------------------------------------------------------

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  label text not null,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  manager_uid uuid references auth.users(id),
  closed boolean not null default false
);

alter table public.shifts enable row level security;

create policy "shifts: members read" on public.shifts for select using (public.is_org_member(org_id));
create policy "shifts: owner/manager write" on public.shifts for all
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

create table public.shift_check_ins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  station text not null check (station in ('floor', 'grill', 'bar', 'riders')),
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz
);

alter table public.shift_check_ins enable row level security;

create policy "checkins: members read" on public.shift_check_ins for select using (public.is_org_member(org_id));
create policy "checkins: floor mgmt write" on public.shift_check_ins for all
  using (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain']))
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain']));

create table public.tip_pool_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  total_kes numeric not null,
  crew_count int not null,
  per_head_kes numeric not null,
  disbursed boolean not null default false,
  disbursed_at timestamptz,
  intasend_tracking_id text,
  disbursement_results jsonb,
  disbursement_error text
);

alter table public.tip_pool_entries enable row level security;

create policy "tips: members read" on public.tip_pool_entries for select using (public.is_org_member(org_id));
create policy "tips: owner/manager create" on public.tip_pool_entries for insert
  with check (public.has_org_role(org_id, array['owner', 'manager']));
-- Disbursement updates (disbursed/disbursed_at/tracking/results) are written
-- only by POST /api/staff/disburse-tips using the service-role key.

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.leave_requests enable row level security;

create policy "leave: members read" on public.leave_requests for select using (public.is_org_member(org_id));
create policy "leave: self can request" on public.leave_requests for insert
  with check (user_id = auth.uid() and public.is_org_member(org_id));
create policy "leave: owner/manager can decide" on public.leave_requests for update
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- loyalty_members / loyalty_ledger / sms_campaigns
-- ---------------------------------------------------------------------------

create table public.loyalty_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  name text not null,
  points int not null default 0,
  tier text not null default 'silver' check (tier in ('silver', 'gold', 'elite')),
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);

alter table public.loyalty_members enable row level security;

create policy "loyalty: members read" on public.loyalty_members for select using (public.is_org_member(org_id));
create policy "loyalty: floor staff write" on public.loyalty_members for all
  using (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']))
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']));

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.loyalty_members(id) on delete cascade,
  type text not null check (type in ('earn', 'redeem')),
  points int not null,
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now()
);

alter table public.loyalty_ledger enable row level security;

create policy "ledger: members read" on public.loyalty_ledger for select using (public.is_org_member(org_id));
create policy "ledger: floor staff write" on public.loyalty_ledger for all
  using (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']))
  with check (public.has_org_role(org_id, array['owner', 'manager', 'floor_captain', 'waiter']));

create table public.sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  message text not null,
  scheduled_at timestamptz,
  sent_at timestamptz,
  audience_count int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent'))
);

alter table public.sms_campaigns enable row level security;

create policy "campaigns: members read" on public.sms_campaigns for select using (public.is_org_member(org_id));
create policy "campaigns: owner/manager create draft" on public.sms_campaigns for insert
  with check (public.has_org_role(org_id, array['owner', 'manager']));
-- Dispatch (status -> 'sent', sent_at, audience_count) is written only by
-- POST /api/loyalty/dispatch-campaign using the service-role key.

-- ---------------------------------------------------------------------------
-- etims_invoices / audit_log
-- ---------------------------------------------------------------------------

create table public.etims_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  control_number text not null,
  gross_kes numeric not null,
  vat_kes numeric not null,
  tourism_levy_kes numeric not null,
  status text not null default 'pending' check (status in ('synced', 'pending', 'error')),
  simulated boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.etims_invoices enable row level security;

create policy "etims: members read" on public.etims_invoices for select using (public.is_org_member(org_id));
create policy "etims: owner/accountant write" on public.etims_invoices for all
  using (public.has_org_role(org_id, array['owner', 'accountant']))
  with check (public.has_org_role(org_id, array['owner', 'accountant']));

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_uid text not null, -- text, not uuid: also carries "system:*" values for server-initiated events
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "audit: owner/manager read" on public.audit_log for select
  using (public.has_org_role(org_id, array['owner', 'manager']));
create policy "audit: members can log their own actions" on public.audit_log for insert
  with check (public.is_org_member(org_id) and actor_uid = auth.uid()::text);
-- No update/delete policy: append-only, matching the Firestore version.

-- ---------------------------------------------------------------------------
-- Realtime: publish every tenant table so the app's postgres_changes
-- subscriptions (the Supabase equivalent of Firestore's onSnapshot) work.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.organizations,
  public.memberships,
  public.stations,
  public.tables,
  public.waitlist,
  public.menu_items,
  public.orders,
  public.payments,
  public.inventory_items,
  public.purchase_orders,
  public.shifts,
  public.shift_check_ins,
  public.tip_pool_entries,
  public.leave_requests,
  public.loyalty_members,
  public.loyalty_ledger,
  public.sms_campaigns,
  public.etims_invoices,
  public.audit_log;

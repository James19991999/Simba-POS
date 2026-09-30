-- Fixes a real bug: onboarding creates the organization, then its first
-- station, then the owner's membership row — in that order. But the
-- original policies gated `organizations` SELECT and every `stations`
-- policy entirely on is_org_member()/has_org_role(), both of which require
-- an EXISTING membership row. During onboarding, no membership exists yet
-- (it's created last), so:
--   - `organizations.insert(...).select().single()` had its SELECT half
--     silently filtered by RLS (Postgres/PostgREST returns `data: null`
--     rather than a loud error when RLS hides the just-inserted row).
--   - `stations.insert(...).select().single()` failed the same way, and
--     the INSERT itself would also have been rejected by the "for all"
--     policy on `stations` (which uses has_org_role for every command,
--     including insert).
-- The app's `createOrganizationAndOwner` then read `.id` off `null` and
-- threw "Could not create your restaurant" — a real, reproducible bug,
-- not an environment issue.
--
-- Fix: add an `is_org_owner` helper that checks `organizations.owner_uid`
-- directly (not `memberships`), and let the org's own owner bypass the
-- membership requirement for reading their own org and managing their own
-- stations. This is safe: `owner_uid` is set once at org creation and can
-- only be changed by the service role (enforced by the `enforce_org_update`
-- trigger already in 0001_init.sql), so this never grants access to
-- anyone but the actual creator of that specific org.

create or replace function public.is_org_owner(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org_id and o.owner_uid = auth.uid()
  );
$$;

drop policy if exists "org: members can read" on public.organizations;
create policy "org: members can read" on public.organizations
  for select using (public.is_org_member(id) or owner_uid = auth.uid());

drop policy if exists "stations: members read" on public.stations;
create policy "stations: members read" on public.stations
  for select using (public.is_org_member(org_id) or public.is_org_owner(org_id));

drop policy if exists "stations: owner/manager write" on public.stations;
create policy "stations: owner/manager write" on public.stations for all
  using (public.has_org_role(org_id, array['owner', 'manager']) or public.is_org_owner(org_id))
  with check (public.has_org_role(org_id, array['owner', 'manager']) or public.is_org_owner(org_id));

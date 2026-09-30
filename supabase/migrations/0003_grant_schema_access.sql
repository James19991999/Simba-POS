-- Fixes "permission denied for schema public".
--
-- Row Level Security policies (0001_init.sql, 0002_fix_onboarding_rls.sql)
-- control WHICH ROWS a role can see or change -- but that's a second gate.
-- The first gate is plain Postgres GRANTs: a role needs USAGE on the
-- public schema and SELECT/INSERT/UPDATE/DELETE on a table before RLS
-- ever gets evaluated at all.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

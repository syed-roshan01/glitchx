-- =============================================================
-- 00013 — Explicit table ACL grants
--
-- Supabase projects grant anon/authenticated/service_role access
-- to public-schema tables via DEFAULT PRIVILEGES. We restate them
-- explicitly so the schema is self-contained (works identically
-- on Supabase, vanilla PostgreSQL, and CI). RLS remains the row
-- security boundary — these grants only open the tables to
-- policy evaluation.
-- =============================================================

-- schema entry
grant usage on schema public to anon, authenticated, service_role;

-- -------------------------------------------------------------
-- anon: the public booking page (+ its realtime subscriptions)
-- RLS limits anon to active resources, active plans and the
-- settings row; every write goes through validated RPCs.
-- -------------------------------------------------------------
grant select on public.resources to anon;
grant select on public.pricing_plans to anon;
grant select on public.settings to anon;
grant select on public.sessions to anon;
grant select on public.bookings to anon;
grant select on public.waitlist to anon;

-- -------------------------------------------------------------
-- authenticated: signed-in staff. Full operational access;
-- RLS policies gate what each role (STAFF/MANAGER/ADMIN) may
-- actually read or change.
-- -------------------------------------------------------------
grant select, insert, update on public.profiles to authenticated;

grant select, insert, update, delete on public.customers to authenticated;

grant select, insert, update on public.sessions to authenticated;
grant select, insert, update, delete on public.session_items to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select, insert, update, delete on public.waitlist to authenticated;

grant select, insert, update on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;
grant select, insert, update on public.payments to authenticated;

grant select, insert, update on public.resources to authenticated;
grant select, insert, update on public.items to authenticated;
grant select, insert, update on public.services to authenticated;
grant select, insert, update on public.pricing_plans to authenticated;
grant select, insert, update on public.pricing_rules to authenticated;

grant select on public.audit_logs to authenticated;
grant select, update on public.settings to authenticated;

-- sequences (booking codes, invoice numbers) used by triggers
grant usage, select on all sequences in schema public to authenticated;

-- -------------------------------------------------------------
-- service_role: server-side API routes (Next.js). Supabase marks
-- this role bypassrls; we keep explicit grants for completeness.
-- -------------------------------------------------------------
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

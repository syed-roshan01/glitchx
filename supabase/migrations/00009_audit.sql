-- =============================================================
-- 00009 — Audit logs
-- Written exclusively by the server (service role). No client
-- INSERT/UPDATE/DELETE policies — the API records admin actions.
-- =============================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index audit_logs_action_idx on public.audit_logs(action);

alter table public.audit_logs enable row level security;

create policy "audit_logs: admin read"
  on public.audit_logs for select
  using (public.is_admin());

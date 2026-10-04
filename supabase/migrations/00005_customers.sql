-- =============================================================
-- 00005 — Customers
-- =============================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  mobile text not null,
  email text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_mobile_unique unique (mobile)
);

create index customers_mobile_idx on public.customers(mobile);
create index customers_name_idx on public.customers(name);

create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS: staff/admin only. Public visitors never touch this table —
-- public bookings capture name+mobile snapshots via RPC instead.
-- -------------------------------------------------------------
alter table public.customers enable row level security;

create policy "customers: staff read"
  on public.customers for select
  using (public.is_staff());

create policy "customers: staff insert"
  on public.customers for insert
  with check (public.is_staff());

create policy "customers: staff update"
  on public.customers for update
  using (public.is_staff())
  with check (public.is_staff());

create policy "customers: admin delete"
  on public.customers for delete
  using (public.is_admin());

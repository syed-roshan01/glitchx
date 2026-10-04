-- =============================================================
-- 00006 — Sessions and session line items
-- =============================================================

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid, -- FK added in 00007 (bookings)
  customer_id uuid not null references public.customers(id) on delete restrict,
  resource_id uuid not null references public.resources(id) on delete restrict,
  pricing_plan_id uuid references public.pricing_plans(id) on delete set null,
  pricing_plan_snapshot jsonb not null default '{}',
  status text not null check (status in ('SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  scheduled_start_time timestamptz,
  actual_start_time timestamptz,
  expected_end_time timestamptz,
  end_time timestamptz,
  paused_at timestamptz,
  total_paused_seconds integer not null default 0 check (total_paused_seconds >= 0),
  duration_seconds integer,
  gaming_amount numeric(10,2),
  discount_type text check (discount_type in ('PERCENT', 'FIXED')),
  discount_value numeric(10,2) check (discount_value is null or discount_value >= 0),
  discount_amount numeric(10,2),
  tax_amount numeric(10,2),
  subtotal numeric(10,2),
  total_amount numeric(10,2),
  payment_status text not null default 'PENDING'
    check (payment_status in ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'WAIVED')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_end_after_start_check
    check (end_time is null or actual_start_time is null or end_time >= actual_start_time)
);

create index sessions_status_idx on public.sessions(status);
create index sessions_resource_idx on public.sessions(resource_id);
create index sessions_customer_idx on public.sessions(customer_id);
create index sessions_created_at_idx on public.sessions(created_at desc);

-- CRITICAL: at most ONE live (ACTIVE/PAUSED) session per resource.
-- Enforced at the database level — immune to race conditions.
create unique index sessions_one_live_per_resource
  on public.sessions(resource_id)
  where status in ('ACTIVE', 'PAUSED');

-- SCHEDULED sessions must not overlap each other on the same resource.
alter table public.sessions
  add constraint sessions_scheduled_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(scheduled_start_time, expected_end_time, '[)') with &&
  )
  where (status = 'SCHEDULED' and scheduled_start_time is not null and expected_end_time is not null);

-- -------------------------------------------------------------
-- Session line items — prices are SNAPSHOTTED so later catalog
-- price changes never alter historical bills/invoices.
-- -------------------------------------------------------------
create table public.session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  item_type text not null check (item_type in ('FOOD', 'DRINK', 'SERVICE', 'GAME', 'OTHER')),
  item_id uuid,
  name_snapshot text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity > 0),
  total_price numeric(10,2) not null check (total_price >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index session_items_session_idx on public.session_items(session_id);
create index session_items_item_idx on public.session_items(item_id);

create trigger sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.sessions enable row level security;

create policy "sessions: staff read"
  on public.sessions for select
  using (public.is_staff());
create policy "sessions: staff insert"
  on public.sessions for insert
  with check (public.is_staff());
create policy "sessions: staff update"
  on public.sessions for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "sessions: admin delete"
  on public.sessions for delete
  using (public.is_admin());

alter table public.session_items enable row level security;

create policy "session_items: staff read"
  on public.session_items for select
  using (public.is_staff());
create policy "session_items: staff insert"
  on public.session_items for insert
  with check (public.is_staff());
create policy "session_items: admin delete"
  on public.session_items for delete
  using (public.is_admin());

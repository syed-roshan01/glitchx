-- =============================================================
-- GlitchX Gaming Cafe — COMPLETE SUPABASE SETUP SCRIPT
--
-- This file is the concatenation of supabase/migrations/00001-00015
-- (do not edit here — edit the migrations and regenerate).
--
-- HOW TO USE
--   1. Open your Supabase project -> SQL Editor -> New query
--   2. Paste this entire file and click RUN
--   3. Success = "Success. No rows returned"
--
-- It creates: tables, indexes, foreign keys, RLS policies,
-- triggers, the RPC function layer, realtime publication,
-- explicit role grants and starter seed data (PS5 01/02,
-- Pool Table, PS5 100/hr, Pool 300/hr, Coke/Water/Chips,
-- Extra Controller...).
--
-- Run ONCE on a FRESH project (or after supabase/reset.sql).
-- The realtime + seed sections are idempotent; table creation
-- is not. Verified against PostgreSQL 18 (see .pgtest/run.cjs).
-- =============================================================
-- FILE: 00001_extensions.sql
--------------------------------------------------------------------
-- =============================================================
-- 00001 — Extensions
-- =============================================================
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- FILE: 00002_profiles.sql
--------------------------------------------------------------------
-- =============================================================
-- 00002 — Profiles, roles and core helpers
-- =============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Staff',
  email text,
  role text not null default 'STAFF' check (role in ('ADMIN', 'MANAGER', 'STAFF')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

-- -------------------------------------------------------------
-- Role helpers (security definer so RLS policies on other tables
-- can resolve the caller's role without recursion on profiles).
-- -------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('ADMIN', 'MANAGER', 'STAFF'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() = 'ADMIN', false);
$$;

-- -------------------------------------------------------------
-- Generic updated_at trigger
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Auto-create a profile whenever a new auth user is created.
-- New users default to STAFF; the first admin is claimed via
-- public.claim_first_admin() during onboarding.
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    'STAFF'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles: self read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: staff read all"
  on public.profiles for select
  using (public.is_staff());

create policy "profiles: admin full control"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- FILE: 00003_settings.sql
--------------------------------------------------------------------
-- =============================================================
-- 00003 — Cafe settings (single row)
-- =============================================================

create table public.settings (
  id text primary key default 'default' check (id = 'default'),
  cafe_name text not null default 'GlitchX Gaming Cafe',
  logo_url text,
  address text,
  phone text,
  email text,
  gstin text,
  currency text not null default 'INR',
  currency_symbol text not null default '₹',
  timezone text not null default 'Asia/Kolkata',
  invoice_prefix text not null default 'INV',
  tax_enabled boolean not null default false,
  tax_name text default 'GST',
  tax_rate numeric(5,2) default 0 check (tax_rate is null or tax_rate >= 0),
  billing_mode text not null default 'ROUND_UP_15'
    check (billing_mode in ('EXACT_MINUTES', 'ROUND_UP_15', 'ROUND_UP_30', 'ROUND_UP_60')),
  min_billing_minutes integer not null default 0 check (min_billing_minutes >= 0),
  pause_enabled boolean not null default true,
  allow_public_bookings boolean not null default true,
  waitlist_enabled boolean not null default true,
  booking_max_days_ahead integer not null default 7 check (booking_max_days_ahead between 0 and 90),
  setup_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values ('default') on conflict (id) do nothing;

create trigger settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS: settings contain only public cafe information.
-- Anyone (including anon visitors on the booking page) may read;
-- only admins may change settings.
-- -------------------------------------------------------------
alter table public.settings enable row level security;

create policy "settings: public read"
  on public.settings for select
  using (true);

create policy "settings: admin update"
  on public.settings for update
  using (public.is_admin())
  with check (public.is_admin());

-- FILE: 00004_catalog.sql
--------------------------------------------------------------------
-- =============================================================
-- 00004 — Catalog: pricing plans, resources, pricing rules,
--          services and items
-- =============================================================

-- -------------------------------------------------------------
-- Pricing plans (rate cards per resource type)
-- billing_type:
--   HOURLY      — price is the hourly rate, billed per minute
--   PER_MINUTE  — price is the per-minute rate
--   FIXED       — flat price for the session
--   PACKAGE     — flat price for up to duration_minutes,
--                 extra time prorated at the package rate
-- -------------------------------------------------------------
create table public.pricing_plans (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  name text not null,
  billing_type text not null check (billing_type in ('HOURLY', 'FIXED', 'PER_MINUTE', 'PACKAGE')),
  price numeric(10,2) not null check (price >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_plans_package_duration_check
    check (billing_type <> 'PACKAGE' or duration_minutes is not null)
);

create index pricing_plans_type_idx on public.pricing_plans(resource_type) where active;

create trigger pricing_plans_updated_at
  before update on public.pricing_plans
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Resources (stations: PS5s, pool tables, PCs, VR, ...)
-- status       — admin-managed base state (ACTIVE/MAINTENANCE/INACTIVE)
-- current_status — DERIVED display state (AVAILABLE/BUSY/RESERVED/
--                  MAINTENANCE) maintained by trigger from live
--                  sessions and bookings. Never set manually.
-- -------------------------------------------------------------
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  description text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
  current_status text not null default 'AVAILABLE'
    check (current_status in ('AVAILABLE', 'BUSY', 'RESERVED', 'MAINTENANCE')),
  default_pricing_plan_id uuid references public.pricing_plans(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index resources_status_idx on public.resources(status) where active;
create index resources_type_idx on public.resources(type);

create trigger resources_updated_at
  before update on public.resources
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Pricing rules (peak hours / weekend overrides)
-- Most specific match wins: resource_id > resource_type > global.
-- price is an HOURLY rate override applied while the rule matches.
-- -------------------------------------------------------------
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  resource_id uuid references public.resources(id) on delete cascade,
  resource_type text,
  days_of_week integer[] not null default '{0,1,2,3,4,5,6}', -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  price numeric(10,2) not null check (price >= 0),
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_window_check
    check (start_time < end_time)
);

create trigger pricing_rules_updated_at
  before update on public.pricing_rules
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Services (additional billable games / add-ons)
-- -------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  billing_type text not null default 'FIXED' check (billing_type in ('FIXED', 'PER_SESSION', 'HOURLY')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger services_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Items (food & drinks, optional inventory tracking)
-- -------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'OTHER' check (category in ('DRINK', 'SNACK', 'FOOD', 'OTHER')),
  price numeric(10,2) not null check (price >= 0),
  cost_price numeric(10,2) check (cost_price is null or cost_price >= 0),
  stock integer check (stock is null or stock >= 0),
  track_inventory boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_category_idx on public.items(category) where active;

create trigger items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.pricing_plans enable row level security;
-- Public visitors need active plans to show "₹100/hour" on the booking page.
create policy "pricing_plans: public read active"
  on public.pricing_plans for select
  using (active);
create policy "pricing_plans: staff read"
  on public.pricing_plans for select
  using (public.is_staff());
-- Core pricing is admin-only (staff only with permission => admin grants role).
create policy "pricing_plans: admin write"
  on public.pricing_plans for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.resources enable row level security;
create policy "resources: public read active"
  on public.resources for select
  using (active);
create policy "resources: staff read"
  on public.resources for select
  using (public.is_staff());
create policy "resources: staff insert"
  on public.resources for insert
  with check (public.is_staff());
create policy "resources: staff update"
  on public.resources for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "resources: admin delete"
  on public.resources for delete
  using (public.is_admin());

alter table public.pricing_rules enable row level security;
create policy "pricing_rules: staff read"
  on public.pricing_rules for select
  using (public.is_staff());
create policy "pricing_rules: admin write"
  on public.pricing_rules for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.services enable row level security;
create policy "services: staff read"
  on public.services for select
  using (public.is_staff());
create policy "services: staff insert"
  on public.services for insert
  with check (public.is_staff());
create policy "services: staff update"
  on public.services for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "services: admin delete"
  on public.services for delete
  using (public.is_admin());

alter table public.items enable row level security;
create policy "items: staff read"
  on public.items for select
  using (public.is_staff());
create policy "items: staff insert"
  on public.items for insert
  with check (public.is_staff());
create policy "items: staff update"
  on public.items for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "items: admin delete"
  on public.items for delete
  using (public.is_admin());

-- FILE: 00005_customers.sql
--------------------------------------------------------------------
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

-- FILE: 00006_sessions.sql
--------------------------------------------------------------------
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

-- FILE: 00007_bookings_waitlist.sql
--------------------------------------------------------------------
-- =============================================================
-- 00007 — Bookings and waitlist
-- =============================================================

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_mobile text not null,
  resource_id uuid not null references public.resources(id) on delete restrict,
  booking_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  estimated_amount numeric(10,2),
  source text not null default 'ADMIN' check (source in ('PUBLIC', 'ADMIN')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_check check (end_time > start_time)
);

create index bookings_date_idx on public.bookings(booking_date desc);
create index bookings_resource_idx on public.bookings(resource_id, start_time);
create index bookings_status_idx on public.bookings(status);
create index bookings_mobile_idx on public.bookings(customer_mobile);

alter table public.sessions
  add constraint sessions_booking_fk
  foreign key (booking_id) references public.bookings(id) on delete set null;

-- CRITICAL: never allow two overlapping live bookings per resource.
-- Exclusion constraint enforced at the database level (race-safe).
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  )
  where (status in ('PENDING', 'CONFIRMED', 'CHECKED_IN'));

-- -------------------------------------------------------------
-- Human-readable booking code: GC-1024
-- -------------------------------------------------------------
create sequence public.booking_code_seq start 1000;

create or replace function public.set_booking_code()
returns trigger
language plpgsql
as $$
begin
  if new.booking_code is null then
    new.booking_code := 'GC-' || nextval('public.booking_code_seq');
  end if;
  return new;
end;
$$;

create trigger bookings_set_code
  before insert on public.bookings
  for each row execute function public.set_booking_code();

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Waitlist / queue
-- -------------------------------------------------------------
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_mobile text not null,
  resource_type text,
  resource_id uuid references public.resources(id) on delete set null,
  requested_duration_minutes integer,
  position integer not null default 1,
  status text not null default 'WAITING'
    check (status in ('WAITING', 'NOTIFIED', 'ASSIGNED', 'CANCELLED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  served_at timestamptz
);

create index waitlist_status_pos_idx on public.waitlist(status, position);
create index waitlist_mobile_idx on public.waitlist(customer_mobile);

-- position assigned on insert (next in line)
create or replace function public.set_waitlist_position()
returns trigger
language plpgsql
as $$
declare
  next_pos integer;
begin
  select coalesce(max(position), 0) + 1 into next_pos
  from public.waitlist where status = 'WAITING';
  new.position := next_pos;
  return new;
end;
$$;

create trigger waitlist_set_position
  before insert on public.waitlist
  for each row execute function public.set_waitlist_position();

-- when an entry leaves the WAITING state, shift the rest up
create or replace function public.shift_waitlist()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'WAITING' and new.status <> 'WAITING' then
    new.served_at := now();
    update public.waitlist
      set position = position - 1, updated_at = now()
      where status = 'WAITING' and position > old.position;
  end if;
  return new;
end;
$$;

create trigger waitlist_shift
  before update on public.waitlist
  for each row execute function public.shift_waitlist();

create trigger waitlist_updated_at
  before update on public.waitlist
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS: no direct anon access — public booking/waitlist creation
-- goes through SECURITY DEFINER RPCs (00010) that validate input.
-- -------------------------------------------------------------
alter table public.bookings enable row level security;

create policy "bookings: staff read"
  on public.bookings for select
  using (public.is_staff());
create policy "bookings: staff insert"
  on public.bookings for insert
  with check (public.is_staff());
create policy "bookings: staff update"
  on public.bookings for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "bookings: admin delete"
  on public.bookings for delete
  using (public.is_admin());

alter table public.waitlist enable row level security;

create policy "waitlist: staff read"
  on public.waitlist for select
  using (public.is_staff());
create policy "waitlist: staff insert"
  on public.waitlist for insert
  with check (public.is_staff());
create policy "waitlist: staff update"
  on public.waitlist for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "waitlist: admin delete"
  on public.waitlist for delete
  using (public.is_admin());

-- FILE: 00008_invoices_payments.sql
--------------------------------------------------------------------
-- =============================================================
-- 00008 — Invoices, invoice items and payments
-- =============================================================

create sequence public.invoice_number_seq start 1;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  session_id uuid references public.sessions(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_mobile text not null,
  resource_name text not null,
  session_start timestamptz,
  session_end timestamptz,
  duration_minutes integer,
  gaming_amount numeric(10,2) not null default 0,
  items_amount numeric(10,2) not null default 0,
  services_amount numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  discount_type text,
  discount_value numeric(10,2),
  tax_name text,
  tax_rate numeric(5,2),
  tax_amount numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  status text not null default 'ISSUED'
    check (status in ('ISSUED', 'PARTIAL', 'PAID', 'VOID')),
  created_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoices_number_idx on public.invoices(invoice_number);
create index invoices_issued_at_idx on public.invoices(issued_at desc);
create index invoices_session_idx on public.invoices(session_id);
create index invoices_customer_idx on public.invoices(customer_id);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  item_type text not null check (item_type in ('GAMING', 'FOOD', 'DRINK', 'SERVICE', 'GAME', 'DISCOUNT', 'OTHER')),
  name_snapshot text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null default 1,
  total_price numeric(10,2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('CASH', 'UPI', 'CARD', 'OTHER')),
  payment_status text not null default 'PAID' check (payment_status in ('PENDING', 'PAID', 'REFUNDED')),
  transaction_reference text,
  paid_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index payments_invoice_idx on public.payments(invoice_id);
create index payments_created_at_idx on public.payments(created_at desc);

-- -------------------------------------------------------------
-- Sequential invoice numbers: INV-2026-00001
-- -------------------------------------------------------------
create or replace function public.set_invoice_number()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  prefix text;
  yr text;
  num bigint;
begin
  if new.invoice_number is null then
    select coalesce(invoice_prefix, 'INV') into prefix
    from public.settings where id = 'default';
    yr := to_char(coalesce(new.issued_at, now()), 'YYYY');
    num := nextval('public.invoice_number_seq');
    new.invoice_number := coalesce(prefix, 'INV') || '-' || yr || '-' || lpad(num::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_set_number
  before insert on public.invoices
  for each row execute function public.set_invoice_number();

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS: no deletes ever — historical invoices are immutable via
-- the API; only admins may VOID. Payments are insert/update only.
-- -------------------------------------------------------------
alter table public.invoices enable row level security;

create policy "invoices: staff read"
  on public.invoices for select
  using (public.is_staff());
create policy "invoices: staff insert"
  on public.invoices for insert
  with check (public.is_staff());
create policy "invoices: admin update (void)"
  on public.invoices for update
  using (public.is_admin())
  with check (public.is_admin());

alter table public.invoice_items enable row level security;

create policy "invoice_items: staff read"
  on public.invoice_items for select
  using (public.is_staff());
create policy "invoice_items: staff insert"
  on public.invoice_items for insert
  with check (public.is_staff());

alter table public.payments enable row level security;

create policy "payments: staff read"
  on public.payments for select
  using (public.is_staff());
create policy "payments: staff insert"
  on public.payments for insert
  with check (public.is_staff());
create policy "payments: admin update (refund)"
  on public.payments for update
  using (public.is_admin())
  with check (public.is_admin());

-- FILE: 00009_audit.sql
--------------------------------------------------------------------
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

-- FILE: 00010_functions.sql
--------------------------------------------------------------------
-- =============================================================
-- 00010 — Server functions (RPC layer)
--
-- Public functions (anon-callable) are strictly validated
-- SECURITY DEFINER functions. Admin functions are revoked from
-- anon/authenticated and called only by the server (service role)
-- from Next.js route handlers.
-- =============================================================

-- -------------------------------------------------------------
-- Derived resource status: AVAILABLE / BUSY / RESERVED /
-- MAINTENANCE. Computed from live sessions + upcoming bookings,
-- maintained by triggers. Never set manually.
-- -------------------------------------------------------------
create or replace function public.refresh_resource_status(p_resource_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_base text;
  v_has_session boolean;
  v_next_booking timestamptz;
  v_new text;
begin
  if p_resource_id is null then return; end if;

  select status into v_base from public.resources where id = p_resource_id;
  if not found then return; end if;

  if v_base in ('MAINTENANCE', 'INACTIVE') then
    v_new := 'MAINTENANCE';
  else
    select exists(
      select 1 from public.sessions
      where resource_id = p_resource_id and status in ('ACTIVE', 'PAUSED')
    ) into v_has_session;

    if v_has_session then
      v_new := 'BUSY';
    else
      select min(start_time) into v_next_booking
      from public.bookings
      where resource_id = p_resource_id
        and status in ('PENDING', 'CONFIRMED')
        and start_time > now()
        and start_time < now() + interval '3 hours';

      if v_next_booking is not null then
        v_new := 'RESERVED';
      else
        v_new := 'AVAILABLE';
      end if;
    end if;
  end if;

  update public.resources
  set current_status = v_new, updated_at = now()
  where id = p_resource_id and current_status is distinct from v_new;
end;
$$;

create or replace function public.sessions_refresh_resource()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_resource_status(old.resource_id);
    return old;
  else
    perform public.refresh_resource_status(new.resource_id);
    return new;
  end if;
end;
$$;

create trigger sessions_refresh_status
  after insert or update or delete on public.sessions
  for each row execute function public.sessions_refresh_resource();

create or replace function public.bookings_refresh_resource()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_resource_status(old.resource_id);
    return old;
  else
    perform public.refresh_resource_status(new.resource_id);
    return new;
  end if;
end;
$$;

create trigger bookings_refresh_status
  after insert or update or delete on public.bookings
  for each row execute function public.bookings_refresh_resource();

create or replace function public.resources_refresh_self()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_resource_status(new.id);
  return new;
end;
$$;

create trigger resources_refresh_status
  after update of status on public.resources
  for each row execute function public.resources_refresh_self();

-- -------------------------------------------------------------
-- Lazy activation: SCHEDULED sessions whose time has come become
-- ACTIVE (only if the resource is free). Called on dashboard /
-- sessions / availability loads. Optionally wire pg_cron:
--   select cron.schedule('activate-sessions', '* * * * *',
--     'select public.activate_due_sessions()');
-- -------------------------------------------------------------
create or replace function public.activate_due_sessions()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer := 0;
  s record;
begin
  for s in
    select id, resource_id from public.sessions
    where status = 'SCHEDULED'
      and scheduled_start_time is not null
      and scheduled_start_time <= now()
  loop
    if not exists (
      select 1 from public.sessions
      where resource_id = s.resource_id
        and status in ('ACTIVE', 'PAUSED')
        and id <> s.id
    ) then
      update public.sessions
      set status = 'ACTIVE',
          actual_start_time = coalesce(actual_start_time, s_start_time()),
          updated_at = now()
      where id = s.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
-- helper used above (keeps activation timestamp exact)
create or replace function public.s_start_time()
returns timestamptz
language sql stable
as $$ select now() $$;

-- -------------------------------------------------------------
-- PUBLIC: availability for the QR booking page
-- -------------------------------------------------------------
create or replace function public.public_get_availability()
returns table (
  resource_id uuid,
  name text,
  resource_type text,
  status text,
  hourly_rate numeric,
  rate_label text,
  plan_name text,
  busy_until timestamptz,
  next_booking_start timestamptz,
  session_started_at timestamptz,
  currency_symbol text
)
language sql stable security definer set search_path = public
as $$
  select
    r.id,
    r.name,
    r.type,
    r.current_status,
    pp.price,
    case pp.billing_type
      when 'HOURLY' then sym.symbol || ' ' || pp.price::text || '/hour'
      when 'PER_MINUTE' then sym.symbol || ' ' || pp.price::text || '/min'
      when 'PACKAGE' then sym.symbol || ' ' || pp.price::text || ' for ' || coalesce(pp.duration_minutes::text, '?') || ' min'
      else sym.symbol || ' ' || pp.price::text || ' flat'
    end,
    pp.name,
    ses.expected_end_time,
    nb.next_start,
    ses.actual_start_time,
    sym.symbol
  from public.resources r
  left join lateral (
    select * from public.pricing_plans pp
    where pp.active
      and (
        pp.id = r.default_pricing_plan_id
        or (r.default_pricing_plan_id is null and pp.resource_type = r.type)
      )
    order by (pp.id = r.default_pricing_plan_id) desc, pp.price asc
    limit 1
  ) pp on true
  left join lateral (
    select actual_start_time, expected_end_time
    from public.sessions
    where resource_id = r.id and status in ('ACTIVE', 'PAUSED')
    order by actual_start_time desc
    limit 1
  ) ses on true
  left join lateral (
    select min(start_time) as next_start
    from public.bookings
    where resource_id = r.id
      and status in ('PENDING', 'CONFIRMED')
      and start_time > now()
  ) nb on true
  cross join (select currency_symbol as symbol from public.settings where id = 'default') sym
  where r.active and r.status <> 'INACTIVE'
  order by r.name;
$$;

-- -------------------------------------------------------------
-- Shared slot-conflict check for bookings
-- -------------------------------------------------------------
create or replace function public.booking_slot_is_free(
  p_resource_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    not exists (
      select 1 from public.bookings
      where resource_id = p_resource_id
        and status in ('PENDING', 'CONFIRMED', 'CHECKED_IN')
        and id is distinct from p_exclude_booking_id
        and tstzrange(start_time, end_time, '[)') && tstzrange(p_start, p_end, '[)')
    )
    and not exists (
      select 1 from public.sessions
      where resource_id = p_resource_id
        and status = 'SCHEDULED'
        and scheduled_start_time is not null
        and expected_end_time is not null
        and tstzrange(scheduled_start_time, expected_end_time, '[)') && tstzrange(p_start, p_end, '[)')
    )
    and not exists (
      select 1 from public.sessions
      where resource_id = p_resource_id
        and status in ('ACTIVE', 'PAUSED')
        and expected_end_time is not null
        and expected_end_time > p_start
    );
$$;

-- Estimated booking amount from the resource's default plan.
create or replace function public.estimate_booking_amount(
  p_resource_id uuid,
  p_duration_minutes integer
)
returns numeric
language sql stable security definer set search_path = public
as $$
  with plan as (
    select pp.billing_type, pp.price, pp.duration_minutes
    from public.pricing_plans pp
    join public.resources r on r.id = p_resource_id
    where pp.active
      and (pp.id = r.default_pricing_plan_id
        or (r.default_pricing_plan_id is null and pp.resource_type = r.type))
    order by (pp.id = r.default_pricing_plan_id) desc, pp.price asc
    limit 1
  )
  select case
    when p.billing_type is null then null
    when p.billing_type = 'HOURLY' then round(p.price * p_duration_minutes / 60.0, 2)
    when p.billing_type = 'PER_MINUTE' then round(p.price * p_duration_minutes, 2)
    when p.billing_type = 'FIXED' then p.price
    when p.billing_type = 'PACKAGE' then
      case
        when p_duration_minutes <= coalesce(p.duration_minutes, p_duration_minutes) then p.price
        else round(p.price + (p_duration_minutes - coalesce(p.duration_minutes, 0)) * (p.price / coalesce(p.duration_minutes, 60)), 2)
      end
    else null
  end
  from plan p;
$$;

-- -------------------------------------------------------------
-- PUBLIC: create a booking from the QR page (no account needed)
-- -------------------------------------------------------------
create or replace function public.public_create_booking(
  p_name text,
  p_mobile text,
  p_resource_id uuid,
  p_start_time timestamptz,
  p_duration_minutes integer,
  p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_settings record;
  v_resource record;
  v_end timestamptz;
  v_est numeric;
  v_id uuid;
  v_code text;
  v_constraint text;
begin
  -- ---- validation (never trust public input) ----
  if p_name is null or length(btrim(p_name)) < 2 or length(p_name) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  if p_mobile is null or p_mobile !~ '^\+?[0-9][0-9\s\-]{6,14}$' then
    raise exception 'INVALID_MOBILE';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 or p_duration_minutes % 5 <> 0 then
    raise exception 'INVALID_DURATION';
  end if;

  select * into v_settings from public.settings where id = 'default';
  if not (coalesce(v_settings.allow_public_bookings, false)) then
    raise exception 'BOOKINGS_DISABLED';
  end if;
  if p_start_time is null or p_start_time < now() - interval '2 minutes' then
    raise exception 'INVALID_START_TIME';
  end if;
  if p_start_time > now() + make_interval(days => greatest(coalesce(v_settings.booking_max_days_ahead, 7), 1)) then
    raise exception 'TOO_FAR_AHEAD';
  end if;

  select id, name, type into v_resource
  from public.resources
  where id = p_resource_id and active and status = 'ACTIVE';
  if not found then
    raise exception 'RESOURCE_UNAVAILABLE';
  end if;

  v_end := p_start_time + make_interval(mins => p_duration_minutes);

  if not public.booking_slot_is_free(p_resource_id, p_start_time, v_end) then
    raise exception 'SLOT_TAKEN';
  end if;

  v_est := public.estimate_booking_amount(p_resource_id, p_duration_minutes);

  insert into public.bookings (
    customer_name, customer_mobile, resource_id, booking_date,
    start_time, end_time, duration_minutes, status,
    estimated_amount, source, notes
  ) values (
    btrim(p_name), btrim(p_mobile), p_resource_id, (p_start_time at time zone coalesce(v_settings.timezone, 'Asia/Kolkata'))::date,
    p_start_time, v_end, p_duration_minutes, 'PENDING', v_est, 'PUBLIC', p_notes
  )
  returning id, booking_code into v_id, v_code;

  return jsonb_build_object(
    'id', v_id,
    'booking_code', v_code,
    'resource_name', v_resource.name,
    'start_time', p_start_time,
    'end_time', v_end,
    'duration_minutes', p_duration_minutes,
    'estimated_amount', v_est
  );
exception
  -- map the race-condition exclusion violation to a friendly code
  when unique_violation then
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    if v_constraint like '%no_overlap%' then
      raise exception 'SLOT_TAKEN';
    end if;
    raise;
end;
$$;

-- -------------------------------------------------------------
-- PUBLIC: join the waitlist
-- -------------------------------------------------------------
create or replace function public.public_join_waitlist(
  p_name text,
  p_mobile text,
  p_resource_id uuid default null,
  p_resource_type text default null,
  p_duration_minutes integer default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_settings record;
  v_position integer;
  v_id uuid;
begin
  if p_name is null or length(btrim(p_name)) < 2 or length(p_name) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  if p_mobile is null or p_mobile !~ '^\+?[0-9][0-9\s\-]{6,14}$' then
    raise exception 'INVALID_MOBILE';
  end if;
  if p_duration_minutes is not null and (p_duration_minutes < 15 or p_duration_minutes > 480) then
    raise exception 'INVALID_DURATION';
  end if;

  select * into v_settings from public.settings where id = 'default';
  if not (coalesce(v_settings.waitlist_enabled, false)) then
    raise exception 'WAITLIST_DISABLED';
  end if;

  insert into public.waitlist (customer_name, customer_mobile, resource_id, resource_type, requested_duration_minutes)
  values (btrim(p_name), btrim(p_mobile), p_resource_id, p_resource_type, p_duration_minutes)
  returning id, position into v_id, v_position;

  return jsonb_build_object('id', v_id, 'position', v_position);
end;
$$;

-- -------------------------------------------------------------
-- PUBLIC: first-time setup status
-- -------------------------------------------------------------
create or replace function public.public_setup_status()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'needs_admin', not exists (select 1 from public.profiles where role = 'ADMIN'),
    'has_resources', exists (select 1 from public.resources where active),
    'has_items', exists (select 1 from public.items where active),
    'has_plans', exists (select 1 from public.pricing_plans where active),
    'setup_completed', exists (select 1 from public.settings where id = 'default' and setup_completed_at is not null)
  );
$$;

-- Claim the ADMIN role for the caller — only works while no admin
-- exists (first-time onboarding). Safe against races via advisory lock.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  perform pg_advisory_xact_lock(hashtext('claim_first_admin'));
  if exists (select 1 from public.profiles where role = 'ADMIN') then
    return false;
  end if;
  update public.profiles set role = 'ADMIN', updated_at = now() where id = auth.uid();
  return true;
end;
$$;

-- =============================================================
-- ADMIN / SERVER functions below — callable only by service role.
-- =============================================================

-- -------------------------------------------------------------
-- Find-or-create a customer by mobile (quick walk-in flow)
-- -------------------------------------------------------------
create or replace function public.admin_find_or_create_customer(
  p_name text,
  p_mobile text,
  p_email text default null,
  p_acting_user uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_name is null or length(btrim(p_name)) < 1 then
    raise exception 'INVALID_NAME';
  end if;
  if p_mobile is null or p_mobile !~ '^\+?[0-9][0-9\s\-]{6,14}$' then
    raise exception 'INVALID_MOBILE';
  end if;

  select id into v_id from public.customers where mobile = btrim(p_mobile);
  if v_id is not null then
    -- keep the freshest name on file
    update public.customers
    set name = btrim(p_name), updated_at = now()
    where id = v_id and name is distinct from btrim(p_name);
    return v_id;
  end if;

  insert into public.customers (name, mobile, email, created_by)
  values (btrim(p_name), btrim(p_mobile), nullif(btrim(coalesce(p_email, '')), ''), p_acting_user)
  returning id into v_id;
  return v_id;
end;
$$;

-- -------------------------------------------------------------
-- Start a session (walk-in or from booking).
-- p_start_time <= now()+1min  => ACTIVE immediately
-- p_start_time in the future  => SCHEDULED (activates lazily)
-- -------------------------------------------------------------
create or replace function public.admin_start_session(
  p_customer_id uuid,
  p_resource_id uuid,
  p_pricing_plan_id uuid,
  p_start_time timestamptz default now(),
  p_expected_minutes integer default null,
  p_booking_id uuid default null,
  p_notes text default null,
  p_acting_user uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_resource record;
  v_plan record;
  v_status text;
  v_expected_end timestamptz;
  v_snapshot jsonb;
  v_id uuid;
  v_start timestamptz := coalesce(p_start_time, now());
  v_constraint text;
begin
  select * into v_plan from public.pricing_plans
  where id = p_pricing_plan_id and active;
  if not found then
    raise exception 'INVALID_PLAN';
  end if;

  select * into v_resource from public.resources
  where id = p_resource_id and active and status = 'ACTIVE';
  if not found then
    raise exception 'RESOURCE_UNAVAILABLE';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'INVALID_CUSTOMER';
  end if;

  if v_start <= now() + interval '1 minute' then
    v_status := 'ACTIVE';
    v_start := now();
  else
    v_status := 'SCHEDULED';
    if p_expected_minutes is null then
      p_expected_minutes := coalesce(v_plan.duration_minutes, 60);
    end if;
    v_expected_end := v_start + make_interval(mins => p_expected_minutes);

    if not public.booking_slot_is_free(p_resource_id, v_start, v_expected_end) then
      raise exception 'SLOT_TAKEN';
    end if;
  end if;

  -- race-safe: the partial unique index on (resource_id) where live
  -- makes a concurrent double-start impossible.
  v_snapshot := jsonb_build_object(
    'name', v_plan.name,
    'billing_type', v_plan.billing_type,
    'price', v_plan.price,
    'duration_minutes', v_plan.duration_minutes
  );

  insert into public.sessions (
    booking_id, customer_id, resource_id, pricing_plan_id, pricing_plan_snapshot,
    status, scheduled_start_time, actual_start_time, expected_end_time,
    notes, created_by
  ) values (
    p_booking_id, p_customer_id, p_resource_id, p_pricing_plan_id, v_snapshot,
    v_status,
    case when v_status = 'SCHEDULED' then v_start end,
    case when v_status = 'ACTIVE' then v_start end,
    case when v_status = 'SCHEDULED' then v_expected_end
         when p_expected_minutes is not null then now() + make_interval(mins => p_expected_minutes)
         else null end,
    p_notes, p_acting_user
  )
  returning id into v_id;

  if p_booking_id is not null then
    update public.bookings set status = 'CHECKED_IN', updated_at = now()
    where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
  end if;

  return v_id;
exception
  when unique_violation then
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    if v_constraint like '%one_live_per_resource%' then
      raise exception 'RESOURCE_BUSY';
    end if;
    raise;
end;
$$;

-- -------------------------------------------------------------
-- Add an item or service to a live session (price snapshotted
-- from the catalog; optional inventory decrement)
-- -------------------------------------------------------------
create or replace function public.admin_add_session_item(
  p_session_id uuid,
  p_item_type text,
  p_catalog_id uuid,
  p_quantity integer default 1,
  p_acting_user uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_name text;
  v_price numeric;
  v_stock integer;
  v_tracked boolean;
  v_id uuid;
  v_total numeric;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_item_type not in ('FOOD', 'DRINK', 'SERVICE', 'GAME', 'OTHER') then
    raise exception 'INVALID_ITEM_TYPE';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status not in ('ACTIVE', 'PAUSED') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  if p_item_type in ('SERVICE', 'GAME') then
    select name, price into v_name, v_price
    from public.services where id = p_catalog_id and active;
    if not found then
      raise exception 'ITEM_NOT_FOUND';
    end if;
  else
    select name, price, stock, track_inventory into v_name, v_price, v_stock, v_tracked
    from public.items where id = p_catalog_id and active;
    if not found then
      raise exception 'ITEM_NOT_FOUND';
    end if;
    if coalesce(v_tracked, false) then
      -- lock the item row and verify/decrement stock atomically
      select stock into v_stock from public.items where id = p_catalog_id for update;
      if v_stock is null or v_stock < p_quantity then
        raise exception 'INSUFFICIENT_STOCK';
      end if;
      update public.items
      set stock = stock - p_quantity, updated_at = now()
      where id = p_catalog_id;
    end if;
  end if;

  v_total := round(v_price * p_quantity, 2);

  insert into public.session_items (
    session_id, item_type, item_id, name_snapshot, unit_price, quantity, total_price, created_by
  ) values (
    p_session_id, p_item_type, p_catalog_id, v_name, v_price, p_quantity, v_total, p_acting_user
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'name', v_name, 'unit_price', v_price,
    'quantity', p_quantity, 'total_price', v_total, 'item_type', p_item_type
  );
end;
$$;

-- -------------------------------------------------------------
-- Pause / resume / discount
-- -------------------------------------------------------------
create or replace function public.admin_pause_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_pause_enabled boolean;
begin
  select coalesce(pause_enabled, true) into v_pause_enabled
  from public.settings where id = 'default';

  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status <> 'ACTIVE' then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  if not v_pause_enabled then
    raise exception 'PAUSE_DISABLED';
  end if;

  update public.sessions
  set status = 'PAUSED', paused_at = now(), updated_at = now()
  where id = p_session_id;
end;
$$;

create or replace function public.admin_resume_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_paused_secs numeric;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status <> 'PAUSED' then
    raise exception 'SESSION_NOT_PAUSED';
  end if;

  v_paused_secs := coalesce(v_session.total_paused_seconds, 0)
    + extract(epoch from (now() - v_session.paused_at));

  update public.sessions
  set status = 'ACTIVE',
      paused_at = null,
      total_paused_seconds = floor(v_paused_secs)::int,
      updated_at = now()
  where id = p_session_id;
end;
$$;

create or replace function public.admin_set_session_discount(
  p_session_id uuid,
  p_discount_type text default null,
  p_discount_value numeric default 0
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_discount_type is not null and p_discount_type not in ('PERCENT', 'FIXED') then
    raise exception 'INVALID_DISCOUNT_TYPE';
  end if;
  if p_discount_value is null or p_discount_value < 0 then
    raise exception 'INVALID_DISCOUNT_VALUE';
  end if;
  if p_discount_type = 'PERCENT' and p_discount_value > 100 then
    raise exception 'INVALID_DISCOUNT_VALUE';
  end if;

  update public.sessions
  set discount_type = p_discount_type,
      discount_value = case when p_discount_type is null then null else p_discount_value end,
      updated_at = now()
  where id = p_session_id
    and status in ('ACTIVE', 'PAUSED', 'SCHEDULED');
end;
$$;

-- -------------------------------------------------------------
-- END SESSION — the atomic billing transaction.
--
-- p_billing = { duration_seconds, gaming_amount } computed by the
-- TypeScript billing engine from DB timestamps (single source of
-- truth for pricing). This function locks the session, recomputes
-- the authoritative elapsed duration from database timestamps,
-- validates consistency, then in ONE transaction:
--   1. finalizes the session
--   2. creates the invoice (+ items with snapshots)
--   3. records the payment (if provided)
--   4. completes the linked booking
--   5. releases the resource
-- -------------------------------------------------------------
create or replace function public.admin_end_session_and_invoice(
  p_session_id uuid,
  p_billing jsonb,
  p_discount_type text default null,
  p_discount_value numeric default 0,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_acting_user uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_customer record;
  v_resource record;
  v_settings record;
  v_end timestamptz := now();
  v_paused_total numeric;
  v_duration integer;
  v_gaming numeric;
  v_items_amt numeric;
  v_services_amt numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_invoice_id uuid;
  v_invoice_number text;
  v_paid boolean := false;
begin
  -- 1. lock & validate the session
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status not in ('ACTIVE', 'PAUSED') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  select * into v_customer from public.customers where id = v_session.customer_id;
  select * into v_resource from public.resources where id = v_session.resource_id;
  select * into v_settings from public.settings where id = 'default';

  -- 2. authoritative duration from DB timestamps
  v_paused_total := coalesce(v_session.total_paused_seconds, 0)
    + case when v_session.paused_at is not null
           then extract(epoch from (v_end - v_session.paused_at)) else 0 end;
  v_duration := greatest(floor(extract(epoch from (v_end - v_session.actual_start_time)) - v_paused_total)::int, 0);

  v_gaming := coalesce((p_billing ->> 'gaming_amount')::numeric, 0);

  -- consistency guard against engine/DB drift (tolerance 60s)
  if abs(v_duration - coalesce((p_billing ->> 'duration_seconds')::numeric, v_duration)) > 60 then
    raise exception 'BILLING_MISMATCH';
  end if;

  -- 3. catalog line totals
  select
    coalesce(sum(total_price) filter (where item_type in ('FOOD', 'DRINK', 'OTHER')), 0),
    coalesce(sum(total_price) filter (where item_type in ('SERVICE', 'GAME')), 0)
  into v_items_amt, v_services_amt
  from public.session_items where session_id = p_session_id;

  -- 4. totals (arithmetic is authoritative here)
  v_subtotal := round(coalesce(v_gaming, 0) + v_items_amt + v_services_amt, 2);

  if p_discount_type = 'PERCENT' then
    v_discount := least(round(v_subtotal * least(coalesce(p_discount_value, 0), 100) / 100.0, 2), v_subtotal);
  elsif p_discount_type = 'FIXED' then
    v_discount := least(coalesce(p_discount_value, 0), v_subtotal);
  else
    v_discount := coalesce(v_session.discount_amount, 0);
    if v_session.discount_type = 'PERCENT' then
      v_discount := least(round(v_subtotal * least(coalesce(v_session.discount_value, 0), 100) / 100.0, 2), v_subtotal);
    elsif v_session.discount_type = 'FIXED' then
      v_discount := least(coalesce(v_session.discount_value, 0), v_subtotal);
    end if;
  end if;

  if coalesce(v_settings.tax_enabled, false) and coalesce(v_settings.tax_rate, 0) > 0 then
    v_tax := round((v_subtotal - v_discount) * v_settings.tax_rate / 100.0, 2);
  else
    v_tax := 0;
  end if;

  v_total := greatest(round(v_subtotal - v_discount + v_tax, 2), 0);

  if p_payment_method is not null and p_payment_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- 5. finalize session
  update public.sessions
  set status = 'COMPLETED',
      end_time = v_end,
      total_paused_seconds = floor(v_paused_total)::int,
      duration_seconds = v_duration,
      gaming_amount = v_gaming,
      discount_type = coalesce(p_discount_type, v_session.discount_type),
      discount_value = case
        when p_discount_type is not null then coalesce(p_discount_value, 0)
        else v_session.discount_value end,
      discount_amount = v_discount,
      tax_amount = v_tax,
      subtotal = v_subtotal,
      total_amount = v_total,
      payment_status = case when p_payment_method is not null or v_total = 0 then 'PAID' else 'PENDING' end,
      paused_at = null,
      updated_at = now()
  where id = p_session_id;

  -- 6. invoice
  insert into public.invoices (
    session_id, customer_id, customer_name, customer_mobile, resource_name,
    session_start, session_end, duration_minutes,
    gaming_amount, items_amount, services_amount,
    discount_amount, discount_type, discount_value,
    tax_name, tax_rate, tax_amount,
    subtotal, total_amount, status, created_by
  ) values (
    p_session_id, v_session.customer_id, v_customer.name, v_customer.mobile, v_resource.name,
    v_session.actual_start_time, v_end, greatest(round(v_duration / 60.0), 0)::int,
    v_gaming, v_items_amt, v_services_amt,
    v_discount, coalesce(p_discount_type, v_session.discount_type),
    case when p_discount_type is not null then coalesce(p_discount_value, 0) else v_session.discount_value end,
    case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_name end,
    case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_rate end,
    v_tax,
    v_subtotal, v_total,
    case when p_payment_method is not null or v_total = 0 then 'PAID' else 'ISSUED' end,
    p_acting_user
  )
  returning id, invoice_number into v_invoice_id, v_invoice_number;

  -- 7. invoice line items (snapshotted)
  insert into public.invoice_items (
    invoice_id, item_type, name_snapshot, unit_price, quantity, total_price, sort_order
  )
  select v_invoice_id, 'GAMING',
         coalesce(v_session.pricing_plan_snapshot ->> 'name', 'Gaming') || ' — ' || v_resource.name,
         v_gaming, 1, v_gaming, 0
  where v_gaming > 0;

  insert into public.invoice_items (
    invoice_id, item_type, name_snapshot, unit_price, quantity, total_price, sort_order
  )
  select v_invoice_id, si.item_type, si.name_snapshot, si.unit_price, si.quantity, si.total_price,
         row_number() over (order by si.created_at)
  from public.session_items si
  where si.session_id = p_session_id;

  -- 8. payment
  if p_payment_method is not null and v_total > 0 then
    insert into public.payments (
      invoice_id, amount, payment_method, payment_status, transaction_reference, paid_at, received_by
    ) values (
      v_invoice_id, v_total, p_payment_method, 'PAID', p_payment_reference, now(), p_acting_user
    );
    v_paid := true;
  end if;

  -- 9. complete linked booking
  if v_session.booking_id is not null then
    update public.bookings set status = 'COMPLETED', updated_at = now()
    where id = v_session.booking_id;
  end if;

  -- 10. release resource (trigger refreshes current_status)

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'session_id', p_session_id,
    'duration_seconds', v_duration,
    'gaming_amount', v_gaming,
    'items_amount', v_items_amt,
    'services_amount', v_services_amt,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'tax_amount', v_tax,
    'total_amount', v_total,
    'paid', v_paid
  );
end;
$$;

-- -------------------------------------------------------------
-- Check in a booking → start the session now
-- -------------------------------------------------------------
create or replace function public.admin_check_in_booking(
  p_booking_id uuid,
  p_acting_user uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_booking record;
  v_customer_id uuid;
  v_plan_id uuid;
  v_session_id uuid;
begin
  select * into v_booking from public.bookings
  where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  v_customer_id := public.admin_find_or_create_customer(
    v_booking.customer_name, v_booking.customer_mobile, null, p_acting_user
  );

  select id into v_plan_id from public.pricing_plans
  where active and resource_type = (
    select type from public.resources where id = v_booking.resource_id
  )
  order by price asc limit 1;

  if v_plan_id is null then
    raise exception 'NO_PRICING_PLAN';
  end if;

  v_session_id := public.admin_start_session(
    v_customer_id, v_booking.resource_id, v_plan_id,
    now(), v_booking.duration_minutes, p_booking_id, v_booking.notes, p_acting_user
  );

  return v_session_id;
end;
$$;

-- -------------------------------------------------------------
-- Admin-create booking (customer selected in dashboard)
-- -------------------------------------------------------------
create or replace function public.admin_create_booking(
  p_customer_id uuid,
  p_resource_id uuid,
  p_start_time timestamptz,
  p_duration_minutes integer,
  p_status text default 'CONFIRMED',
  p_notes text default null,
  p_acting_user uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_customer record;
  v_resource record;
  v_end timestamptz;
  v_est numeric;
  v_id uuid;
  v_code text;
  v_settings record;
  v_constraint text;
begin
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    raise exception 'INVALID_CUSTOMER';
  end if;

  select * into v_resource from public.resources
  where id = p_resource_id and active and status = 'ACTIVE';
  if not found then
    raise exception 'RESOURCE_UNAVAILABLE';
  end if;

  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'INVALID_DURATION';
  end if;
  if p_status not in ('PENDING', 'CONFIRMED') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_settings from public.settings where id = 'default';

  v_end := p_start_time + make_interval(mins => p_duration_minutes);

  if not public.booking_slot_is_free(p_resource_id, p_start_time, v_end) then
    raise exception 'SLOT_TAKEN';
  end if;

  v_est := public.estimate_booking_amount(p_resource_id, p_duration_minutes);

  insert into public.bookings (
    customer_id, customer_name, customer_mobile, resource_id, booking_date,
    start_time, end_time, duration_minutes, status, estimated_amount, source, notes
  ) values (
    p_customer_id, v_customer.name, v_customer.mobile, p_resource_id,
    (p_start_time at time zone coalesce(v_settings.timezone, 'Asia/Kolkata'))::date,
    p_start_time, v_end, p_duration_minutes, p_status, v_est, 'ADMIN', p_notes
  )
  returning id, booking_code into v_id, v_code;

  return jsonb_build_object('id', v_id, 'booking_code', v_code, 'estimated_amount', v_est);
exception
  when unique_violation then
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    if v_constraint like '%no_overlap%' then
      raise exception 'SLOT_TAKEN';
    end if;
    raise;
end;
$$;

-- -------------------------------------------------------------
-- Reschedule a booking (conflict-checked)
-- -------------------------------------------------------------
create or replace function public.admin_reschedule_booking(
  p_booking_id uuid,
  p_new_start timestamptz,
  p_duration_minutes integer default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_booking record;
  v_end timestamptz;
  v_duration integer;
  v_tz text;
  v_constraint text;
begin
  select * into v_booking from public.bookings
  where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  v_duration := coalesce(p_duration_minutes, v_booking.duration_minutes);
  if v_duration < 15 or v_duration > 480 then
    raise exception 'INVALID_DURATION';
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz
  from public.settings where id = 'default';

  v_end := p_new_start + make_interval(mins => v_duration);

  if not public.booking_slot_is_free(v_booking.resource_id, p_new_start, v_end, p_booking_id) then
    raise exception 'SLOT_TAKEN';
  end if;

  update public.bookings
  set start_time = p_new_start,
      end_time = v_end,
      duration_minutes = v_duration,
      booking_date = (p_new_start at time zone v_tz)::date,
      updated_at = now()
  where id = p_booking_id;
exception
  when unique_violation then
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    if v_constraint like '%no_overlap%' then
      raise exception 'SLOT_TAKEN';
    end if;
    raise;
end;
$$;

-- -------------------------------------------------------------
-- Booking status transitions (confirm / cancel / no-show)
-- -------------------------------------------------------------
create or replace function public.admin_update_booking_status(
  p_booking_id uuid,
  p_status text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_current text;
begin
  if p_status not in ('PENDING', 'CONFIRMED', 'CANCELLED', 'NO_SHOW', 'COMPLETED') then
    raise exception 'INVALID_STATUS';
  end if;

  select status into v_current from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if v_current in ('CANCELLED', 'NO_SHOW', 'COMPLETED') then
    raise exception 'BOOKING_CLOSED';
  end if;

  update public.bookings set status = p_status, updated_at = now()
  where id = p_booking_id;
end;
$$;

-- -------------------------------------------------------------
-- Grant public functions to anon/authenticated; keep admin
-- functions service-role-only.
-- -------------------------------------------------------------
grant execute on function public.public_get_availability() to anon, authenticated;
grant execute on function public.public_create_booking(text, text, uuid, timestamptz, integer, text) to anon, authenticated;
grant execute on function public.public_join_waitlist(text, text, uuid, text, integer) to anon, authenticated;
grant execute on function public.public_setup_status() to anon, authenticated;
grant execute on function public.claim_first_admin() to anon, authenticated;
grant execute on function public.activate_due_sessions() to anon, authenticated;
grant execute on function public.estimate_booking_amount(uuid, integer) to anon, authenticated;

revoke execute on function public.admin_find_or_create_customer(text, text, text, uuid) from anon, authenticated;
revoke execute on function public.admin_start_session(uuid, uuid, uuid, timestamptz, integer, uuid, text, uuid) from anon, authenticated;
revoke execute on function public.admin_add_session_item(uuid, text, uuid, integer, uuid) from anon, authenticated;
revoke execute on function public.admin_pause_session(uuid) from anon, authenticated;
revoke execute on function public.admin_resume_session(uuid) from anon, authenticated;
revoke execute on function public.admin_set_session_discount(uuid, text, numeric) from anon, authenticated;
revoke execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid) from anon, authenticated;
revoke execute on function public.admin_check_in_booking(uuid, uuid) from anon, authenticated;
revoke execute on function public.admin_create_booking(uuid, uuid, timestamptz, integer, text, text, uuid) from anon, authenticated;
revoke execute on function public.admin_reschedule_booking(uuid, timestamptz, integer) from anon, authenticated;
revoke execute on function public.admin_update_booking_status(uuid, text) from anon, authenticated;
revoke execute on function public.refresh_resource_status(uuid) from anon, authenticated;
revoke execute on function public.booking_slot_is_free(uuid, timestamptz, timestamptz, uuid) from anon, authenticated;

-- FILE: 00011_realtime.sql
--------------------------------------------------------------------
-- =============================================================
-- 00011 — Realtime publication
-- Admin dashboards and the public booking page subscribe to
-- these tables. Row-level security applies to subscriptions.
-- Idempotent: safe to re-run.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.resources;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.session_items;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FILE: 00012_seed.sql
--------------------------------------------------------------------
-- =============================================================
-- 00012 — Seed data (idempotent)
-- Resources: 2× PS5 + 1 Pool Table. Pricing: PS5 ₹100/hr,
-- Pool ₹300/hr. Starter items, services and default settings.
-- =============================================================

-- Pricing plans
insert into public.pricing_plans (resource_type, name, billing_type, price, duration_minutes)
select * from (values
  ('PLAYSTATION', 'PS5 Hourly', 'HOURLY', 100.00, null::integer),
  ('PLAYSTATION', 'PS5 — 2 Hour Package', 'PACKAGE', 180.00, 120),
  ('POOL', 'Pool Hourly', 'HOURLY', 300.00, null::integer),
  ('POOL', 'Pool — 30 Minutes', 'PACKAGE', 150.00, 30)
) as seed(resource_type, name, billing_type, price, duration_minutes)
where not exists (
  select 1 from public.pricing_plans p
  where p.resource_type = seed.resource_type and p.name = seed.name
);

-- Resources
insert into public.resources (name, type, description)
select * from (values
  ('PS5 01', 'PLAYSTATION', 'PlayStation 5 station — 4K TV, dual controllers'),
  ('PS5 02', 'PLAYSTATION', 'PlayStation 5 station — 4K TV, dual controllers'),
  ('Pool Table', 'POOL', 'Full-size pool table with cues and balls')
) as seed(name, type, description)
where not exists (select 1 from public.resources r where r.name = seed.name);

-- Link each resource to its default plan (cheapest hourly of its type)
update public.resources r
set default_pricing_plan_id = p.id
from public.pricing_plans p
where p.resource_type = r.type
  and p.billing_type = 'HOURLY'
  and p.active
  and r.default_pricing_plan_id is null
  and p.price = (
    select min(p2.price) from public.pricing_plans p2
    where p2.resource_type = r.type and p2.billing_type = 'HOURLY' and p2.active
  );

-- Items (food & drinks)
insert into public.items (name, category, price)
select * from (values
  ('Coke', 'DRINK', 40.00),
  ('Pepsi', 'DRINK', 40.00),
  ('Water Bottle', 'DRINK', 20.00),
  ('Energy Drink', 'DRINK', 100.00),
  ('Chips', 'SNACK', 30.00),
  ('Popcorn', 'SNACK', 40.00)
) as seed(name, category, price)
where not exists (select 1 from public.items i where i.name = seed.name);

-- Services (additional games / add-ons)
insert into public.services (name, description, price)
select * from (values
  ('Extra Controller', 'Additional controller for the session', 50.00),
  ('Premium Game', 'New-release premium game unlock', 50.00),
  ('FIFA Tournament Entry', 'FIFA tournament participation', 100.00),
  ('Racing Game', 'Racing game with wheel setup', 100.00),
  ('VR Game', 'VR headset game session', 150.00)
) as seed(name, description, price)
where not exists (select 1 from public.services s where s.name = seed.name);

-- FILE: 00013_grants.sql
--------------------------------------------------------------------
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

-- FILE: 00014_security_payments_booking.sql
--------------------------------------------------------------------
-- =============================================================
-- 00014 — Security hardening, atomic payments, booking UX RPCs
--
--  1. Admin-only functions were still executable by anon via the
--     default PUBLIC execute grant (revoking from anon/authenticated
--     alone does not remove it). Revoke from PUBLIC.
--  2. Self-signup no longer yields staff access: new auth users get
--     an INACTIVE profile; claim_first_admin() / the staff API
--     activate legitimate accounts. Role helpers ignore inactive
--     profiles, so RLS denies them too.
--  3. admin_record_payment(): locks the invoice so concurrent
--     payments cannot overpay; updates invoice + session status in
--     the same transaction.
--  4. Public booking UX: busy intervals for the slot picker (no
--     customer data), and booking lookup / cancel by code + mobile.
--
-- Safe to run on an existing database (idempotent).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Lock down admin/internal functions
-- -------------------------------------------------------------
revoke execute on function public.admin_find_or_create_customer(text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_start_session(uuid, uuid, uuid, timestamptz, integer, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_add_session_item(uuid, text, uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function public.admin_pause_session(uuid) from public, anon, authenticated;
revoke execute on function public.admin_resume_session(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_session_discount(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_check_in_booking(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_create_booking(uuid, uuid, timestamptz, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_reschedule_booking(uuid, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.admin_update_booking_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.refresh_resource_status(uuid) from public, anon, authenticated;
revoke execute on function public.booking_slot_is_free(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

grant execute on function public.admin_find_or_create_customer(text, text, text, uuid) to service_role;
grant execute on function public.admin_start_session(uuid, uuid, uuid, timestamptz, integer, uuid, text, uuid) to service_role;
grant execute on function public.admin_add_session_item(uuid, text, uuid, integer, uuid) to service_role;
grant execute on function public.admin_pause_session(uuid) to service_role;
grant execute on function public.admin_resume_session(uuid) to service_role;
grant execute on function public.admin_set_session_discount(uuid, text, numeric) to service_role;
grant execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid) to service_role;
grant execute on function public.admin_check_in_booking(uuid, uuid) to service_role;
grant execute on function public.admin_create_booking(uuid, uuid, timestamptz, integer, text, text, uuid) to service_role;
grant execute on function public.admin_reschedule_booking(uuid, timestamptz, integer) to service_role;
grant execute on function public.admin_update_booking_status(uuid, text) to service_role;
grant execute on function public.refresh_resource_status(uuid) to service_role;
grant execute on function public.booking_slot_is_free(uuid, timestamptz, timestamptz, uuid) to service_role;

-- -------------------------------------------------------------
-- 2. Self-signup hardening
-- -------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- inactive until claimed as first admin or activated by an admin
  insert into public.profiles (id, name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    'STAFF',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.claim_first_admin()
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  perform pg_advisory_xact_lock(hashtext('claim_first_admin'));
  if exists (select 1 from public.profiles where role = 'ADMIN' and active) then
    return false;
  end if;
  update public.profiles
  set role = 'ADMIN', active = true, updated_at = now()
  where id = auth.uid();
  return true;
end;
$$;

-- -------------------------------------------------------------
-- 3. Atomic payment recording
-- -------------------------------------------------------------
create or replace function public.admin_record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text default null,
  p_acting_user uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_inv record;
  v_paid numeric;
  v_remaining numeric;
  v_status text;
  v_payment_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;
  if v_inv.status = 'VOID' then
    raise exception 'INVOICE_VOID';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = p_invoice_id and payment_status = 'PAID';

  v_remaining := greatest(v_inv.total_amount - v_paid, 0);
  if p_amount > v_remaining + 0.01 then
    raise exception 'PAYMENT_EXCEEDS_BALANCE';
  end if;

  insert into public.payments (
    invoice_id, amount, payment_method, payment_status,
    transaction_reference, paid_at, received_by
  ) values (
    p_invoice_id, round(p_amount, 2), p_method, 'PAID',
    nullif(btrim(coalesce(p_reference, '')), ''), now(), p_acting_user
  )
  returning id into v_payment_id;

  v_status := case when v_paid + p_amount >= v_inv.total_amount - 0.01 then 'PAID' else 'PARTIAL' end;

  update public.invoices set status = v_status, updated_at = now() where id = p_invoice_id;
  if v_inv.session_id is not null then
    update public.sessions set payment_status = v_status, updated_at = now()
    where id = v_inv.session_id;
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'invoice_status', v_status,
    'paid_total', round(v_paid + p_amount, 2),
    'remaining', greatest(round(v_inv.total_amount - v_paid - p_amount, 2), 0)
  );
end;
$$;

revoke execute on function public.admin_record_payment(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_record_payment(uuid, numeric, text, text, uuid) to service_role;

-- -------------------------------------------------------------
-- 4a. PUBLIC: busy intervals for the slot picker (no customer data)
-- -------------------------------------------------------------
create or replace function public.public_get_busy_slots(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  resource_id uuid,
  start_time timestamptz,
  end_time timestamptz,
  kind text
)
language sql stable security definer set search_path = public
as $$
  -- bookings that hold the slot
  select b.resource_id, b.start_time, b.end_time, 'BOOKING'::text
  from public.bookings b
  where b.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN')
    and b.end_time > p_from and b.start_time < p_to
  union all
  -- scheduled walk-ins
  select s.resource_id, s.scheduled_start_time, s.expected_end_time, 'SCHEDULED'::text
  from public.sessions s
  where s.status = 'SCHEDULED'
    and s.scheduled_start_time is not null
    and s.expected_end_time is not null
    and s.expected_end_time > p_from and s.scheduled_start_time < p_to
  union all
  -- running sessions: busy from now until their expected end
  -- (open-ended sessions are reported with a null end)
  select s.resource_id, coalesce(s.actual_start_time, now()), s.expected_end_time, 'LIVE'::text
  from public.sessions s
  where s.status in ('ACTIVE', 'PAUSED')
$$;

-- -------------------------------------------------------------
-- 4b. PUBLIC: look up / cancel own booking (code + mobile)
-- -------------------------------------------------------------
create or replace function public.mobile_digits(p text)
returns text
language sql immutable
as $$ select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) $$;

create or replace function public.public_lookup_booking(p_code text, p_mobile text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v record;
begin
  if p_code is null or length(btrim(p_code)) < 3 or p_mobile is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  select b.booking_code, b.status, b.start_time, b.end_time, b.duration_minutes,
         b.estimated_amount, b.customer_name, r.name as resource_name
  into v
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  where upper(b.booking_code) = upper(btrim(p_code))
    and public.mobile_digits(b.customer_mobile) = public.mobile_digits(p_mobile)
    and length(public.mobile_digits(p_mobile)) >= 7;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'booking_code', v.booking_code,
    'status', v.status,
    'start_time', v.start_time,
    'end_time', v.end_time,
    'duration_minutes', v.duration_minutes,
    'estimated_amount', v.estimated_amount,
    'customer_name', v.customer_name,
    'resource_name', v.resource_name
  );
end;
$$;

create or replace function public.public_cancel_booking(p_code text, p_mobile text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
begin
  select b.id, b.status into v_id, v_status
  from public.bookings b
  where upper(b.booking_code) = upper(btrim(coalesce(p_code, '')))
    and public.mobile_digits(b.customer_mobile) = public.mobile_digits(p_mobile)
    and length(public.mobile_digits(p_mobile)) >= 7
  for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_NOT_CANCELLABLE';
  end if;
  update public.bookings set status = 'CANCELLED', updated_at = now() where id = v_id;
  return jsonb_build_object('booking_code', upper(btrim(p_code)), 'status', 'CANCELLED');
end;
$$;

grant execute on function public.public_get_busy_slots(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.public_lookup_booking(text, text) to anon, authenticated;
grant execute on function public.public_cancel_booking(text, text) to anon, authenticated;
grant execute on function public.mobile_digits(text) to anon, authenticated, service_role;

-- FILE: 00015_quick_sessions_pricing_ledger.sql
--------------------------------------------------------------------
-- =============================================================
-- 00015 — Quick-start sessions, custom session prices, walk-ins,
--          consistent estimates, income & expense ledger
--
--  * Sessions can start without customer details (customer_id is
--    nullable; optional guest_name / guest_mobile). Details can be
--    added later — including after the invoice was issued.
--  * Staff can override the price for a single session (snapshot
--    flagged custom; peak rules never override it) and change it
--    while the session runs.
--  * Estimates use the cafe rounding policy, exactly like the bill.
--  * Booking check-in uses the station's DEFAULT plan (was: the
--    cheapest plan of that type, e.g. a 30-min package).
--  * Customer lookup by mobile ignores formatting (spaces, +91).
--  * ledger_entries: manual income & expenses.
--
-- Safe to run once on the live database (idempotent where possible).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Walk-in sessions
-- -------------------------------------------------------------
alter table public.sessions alter column customer_id drop not null;
alter table public.sessions add column if not exists guest_name text
  check (guest_name is null or length(guest_name) <= 120);
alter table public.sessions add column if not exists guest_mobile text
  check (guest_mobile is null or length(guest_mobile) <= 20);

-- -------------------------------------------------------------
-- 2. Customer lookup ignores mobile formatting
-- -------------------------------------------------------------
create or replace function public.admin_find_or_create_customer(
  p_name text,
  p_mobile text,
  p_email text default null,
  p_acting_user uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_mobile is null or p_mobile !~ '^\+?[0-9][0-9\s\-]{6,14}$' then
    raise exception 'INVALID_MOBILE';
  end if;

  select id into v_id from public.customers
  where mobile = btrim(p_mobile)
     or public.mobile_digits(mobile) = public.mobile_digits(p_mobile)
  order by (mobile = btrim(p_mobile)) desc, created_at
  limit 1;

  if v_id is not null then
    -- keep the freshest name on file (when one was given)
    if v_name is not null then
      update public.customers
      set name = v_name, updated_at = now()
      where id = v_id and name is distinct from v_name;
    end if;
    return v_id;
  end if;

  insert into public.customers (name, mobile, email, created_by)
  values (coalesce(v_name, 'Guest'), btrim(p_mobile), nullif(btrim(coalesce(p_email, '')), ''), p_acting_user)
  returning id into v_id;
  return v_id;
end;
$$;

-- -------------------------------------------------------------
-- 3. Start session: optional customer, optional custom price
-- -------------------------------------------------------------
drop function if exists public.admin_start_session(uuid, uuid, uuid, timestamptz, integer, uuid, text, uuid);

create or replace function public.admin_start_session(
  p_customer_id uuid,
  p_resource_id uuid,
  p_pricing_plan_id uuid,
  p_start_time timestamptz default now(),
  p_expected_minutes integer default null,
  p_booking_id uuid default null,
  p_notes text default null,
  p_acting_user uuid default null,
  p_custom_price numeric default null,
  p_guest_name text default null,
  p_guest_mobile text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_resource record;
  v_plan record;
  v_status text;
  v_expected_end timestamptz;
  v_snapshot jsonb;
  v_id uuid;
  v_start timestamptz := coalesce(p_start_time, now());
  v_constraint text;
begin
  select * into v_plan from public.pricing_plans
  where id = p_pricing_plan_id and active;
  if not found then
    raise exception 'INVALID_PLAN';
  end if;

  select * into v_resource from public.resources
  where id = p_resource_id and active and status = 'ACTIVE';
  if not found then
    raise exception 'RESOURCE_UNAVAILABLE';
  end if;

  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'INVALID_CUSTOMER';
  end if;

  if p_custom_price is not null and (p_custom_price < 0 or p_custom_price > 1000000) then
    raise exception 'INVALID_PRICE';
  end if;

  if v_start <= now() + interval '1 minute' then
    v_status := 'ACTIVE';
    v_start := now();
  else
    v_status := 'SCHEDULED';
    if p_expected_minutes is null then
      p_expected_minutes := coalesce(v_plan.duration_minutes, 60);
    end if;
    v_expected_end := v_start + make_interval(mins => p_expected_minutes);

    if not public.booking_slot_is_free(p_resource_id, v_start, v_expected_end) then
      raise exception 'SLOT_TAKEN';
    end if;
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_plan.name,
    'billing_type', v_plan.billing_type,
    'price', coalesce(round(p_custom_price, 2), v_plan.price),
    'duration_minutes', v_plan.duration_minutes
  );
  if p_custom_price is not null and round(p_custom_price, 2) <> v_plan.price then
    v_snapshot := v_snapshot || jsonb_build_object('custom', true, 'base_price', v_plan.price);
  end if;

  insert into public.sessions (
    booking_id, customer_id, resource_id, pricing_plan_id, pricing_plan_snapshot,
    status, scheduled_start_time, actual_start_time, expected_end_time,
    notes, created_by, guest_name, guest_mobile
  ) values (
    p_booking_id, p_customer_id, p_resource_id, p_pricing_plan_id, v_snapshot,
    v_status,
    case when v_status = 'SCHEDULED' then v_start end,
    case when v_status = 'ACTIVE' then v_start end,
    case when v_status = 'SCHEDULED' then v_expected_end
         when p_expected_minutes is not null then now() + make_interval(mins => p_expected_minutes)
         else null end,
    p_notes, p_acting_user,
    nullif(btrim(coalesce(p_guest_name, '')), ''),
    nullif(btrim(coalesce(p_guest_mobile, '')), '')
  )
  returning id into v_id;

  if p_booking_id is not null then
    update public.bookings set status = 'CHECKED_IN', updated_at = now()
    where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
  end if;

  return v_id;
exception
  when unique_violation then
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    if v_constraint like '%one_live_per_resource%' then
      raise exception 'RESOURCE_BUSY';
    end if;
    raise;
end;
$$;

-- -------------------------------------------------------------
-- 4. Change the price of a running / scheduled session
-- -------------------------------------------------------------
create or replace function public.admin_set_session_price(
  p_session_id uuid,
  p_price numeric
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_base numeric;
begin
  if p_price is null or p_price < 0 or p_price > 1000000 then
    raise exception 'INVALID_PRICE';
  end if;
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status not in ('ACTIVE', 'PAUSED', 'SCHEDULED') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  v_base := coalesce(
    (v_session.pricing_plan_snapshot ->> 'base_price')::numeric,
    (select price from public.pricing_plans where id = v_session.pricing_plan_id),
    (v_session.pricing_plan_snapshot ->> 'price')::numeric
  );

  update public.sessions
  set pricing_plan_snapshot = case
        when round(p_price, 2) = v_base
          then (pricing_plan_snapshot - 'custom' - 'base_price') || jsonb_build_object('price', v_base)
        else pricing_plan_snapshot || jsonb_build_object('price', round(p_price, 2), 'custom', true, 'base_price', v_base)
      end,
      updated_at = now()
  where id = p_session_id;
end;
$$;

-- -------------------------------------------------------------
-- 5. Add / change customer details on any session (+ its invoice)
-- -------------------------------------------------------------
create or replace function public.admin_set_session_customer(
  p_session_id uuid,
  p_name text default null,
  p_mobile text default null,
  p_acting_user uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_mobile text := nullif(btrim(coalesce(p_mobile, '')), '');
  v_customer_id uuid;
  v_cust_name text;
  v_cust_mobile text;
begin
  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  if v_mobile is not null and v_mobile !~ '^\+?[0-9][0-9\s\-]{6,14}$' then
    raise exception 'INVALID_MOBILE';
  end if;

  if v_mobile is not null then
    v_customer_id := public.admin_find_or_create_customer(v_name, v_mobile, null, p_acting_user);
  end if;

  update public.sessions
  set customer_id = v_customer_id,
      guest_name = v_name,
      guest_mobile = v_mobile,
      updated_at = now()
  where id = p_session_id;

  -- keep an already-issued invoice in sync with the customer details
  if v_customer_id is not null then
    select name, mobile into v_cust_name, v_cust_mobile from public.customers where id = v_customer_id;
  end if;
  update public.invoices
  set customer_id = v_customer_id,
      customer_name = coalesce(v_name, v_cust_name, 'Walk-in'),
      customer_mobile = coalesce(v_mobile, v_cust_mobile, ''),
      updated_at = now()
  where session_id = p_session_id;
end;
$$;

-- -------------------------------------------------------------
-- 6. End session: walk-ins get "Walk-in" on the invoice
-- -------------------------------------------------------------
create or replace function public.admin_end_session_and_invoice(
  p_session_id uuid,
  p_billing jsonb,
  p_discount_type text default null,
  p_discount_value numeric default 0,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_acting_user uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_cust_name text;
  v_cust_mobile text;
  v_resource record;
  v_settings record;
  v_end timestamptz := now();
  v_paused_total numeric;
  v_duration integer;
  v_gaming numeric;
  v_items_amt numeric;
  v_services_amt numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_invoice_id uuid;
  v_invoice_number text;
  v_paid boolean := false;
begin
  -- 1. lock & validate the session
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status not in ('ACTIVE', 'PAUSED') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  if v_session.customer_id is not null then
    select name, mobile into v_cust_name, v_cust_mobile from public.customers where id = v_session.customer_id;
  end if;
  select * into v_resource from public.resources where id = v_session.resource_id;
  select * into v_settings from public.settings where id = 'default';

  -- 2. authoritative duration from DB timestamps
  v_paused_total := coalesce(v_session.total_paused_seconds, 0)
    + case when v_session.paused_at is not null
           then extract(epoch from (v_end - v_session.paused_at)) else 0 end;
  v_duration := greatest(floor(extract(epoch from (v_end - v_session.actual_start_time)) - v_paused_total)::int, 0);

  v_gaming := coalesce((p_billing ->> 'gaming_amount')::numeric, 0);

  -- consistency guard against engine/DB drift (tolerance 60s)
  if abs(v_duration - coalesce((p_billing ->> 'duration_seconds')::numeric, v_duration)) > 60 then
    raise exception 'BILLING_MISMATCH';
  end if;

  -- 3. catalog line totals
  select
    coalesce(sum(total_price) filter (where item_type in ('FOOD', 'DRINK', 'OTHER')), 0),
    coalesce(sum(total_price) filter (where item_type in ('SERVICE', 'GAME')), 0)
  into v_items_amt, v_services_amt
  from public.session_items where session_id = p_session_id;

  -- 4. totals (arithmetic is authoritative here)
  v_subtotal := round(coalesce(v_gaming, 0) + v_items_amt + v_services_amt, 2);

  if p_discount_type = 'PERCENT' then
    v_discount := least(round(v_subtotal * least(coalesce(p_discount_value, 0), 100) / 100.0, 2), v_subtotal);
  elsif p_discount_type = 'FIXED' then
    v_discount := least(coalesce(p_discount_value, 0), v_subtotal);
  else
    v_discount := coalesce(v_session.discount_amount, 0);
    if v_session.discount_type = 'PERCENT' then
      v_discount := least(round(v_subtotal * least(coalesce(v_session.discount_value, 0), 100) / 100.0, 2), v_subtotal);
    elsif v_session.discount_type = 'FIXED' then
      v_discount := least(coalesce(v_session.discount_value, 0), v_subtotal);
    end if;
  end if;

  if coalesce(v_settings.tax_enabled, false) and coalesce(v_settings.tax_rate, 0) > 0 then
    v_tax := round((v_subtotal - v_discount) * v_settings.tax_rate / 100.0, 2);
  else
    v_tax := 0;
  end if;

  v_total := greatest(round(v_subtotal - v_discount + v_tax, 2), 0);

  if p_payment_method is not null and p_payment_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- 5. finalize session
  update public.sessions
  set status = 'COMPLETED',
      end_time = v_end,
      total_paused_seconds = floor(v_paused_total)::int,
      duration_seconds = v_duration,
      gaming_amount = v_gaming,
      discount_type = coalesce(p_discount_type, v_session.discount_type),
      discount_value = case
        when p_discount_type is not null then coalesce(p_discount_value, 0)
        else v_session.discount_value end,
      discount_amount = v_discount,
      tax_amount = v_tax,
      subtotal = v_subtotal,
      total_amount = v_total,
      payment_status = case when p_payment_method is not null or v_total = 0 then 'PAID' else 'PENDING' end,
      paused_at = null,
      updated_at = now()
  where id = p_session_id;

  -- 6. invoice
  insert into public.invoices (
    session_id, customer_id, customer_name, customer_mobile, resource_name,
    session_start, session_end, duration_minutes,
    gaming_amount, items_amount, services_amount,
    discount_amount, discount_type, discount_value,
    tax_name, tax_rate, tax_amount,
    subtotal, total_amount, status, created_by
  ) values (
    p_session_id, v_session.customer_id,
    coalesce(v_cust_name, nullif(btrim(v_session.guest_name), ''), 'Walk-in'),
    coalesce(v_cust_mobile, nullif(btrim(v_session.guest_mobile), ''), ''),
    v_resource.name,
    v_session.actual_start_time, v_end, greatest(round(v_duration / 60.0), 0)::int,
    v_gaming, v_items_amt, v_services_amt,
    v_discount, coalesce(p_discount_type, v_session.discount_type),
    case when p_discount_type is not null then coalesce(p_discount_value, 0) else v_session.discount_value end,
    case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_name end,
    case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_rate end,
    v_tax,
    v_subtotal, v_total,
    case when p_payment_method is not null or v_total = 0 then 'PAID' else 'ISSUED' end,
    p_acting_user
  )
  returning id, invoice_number into v_invoice_id, v_invoice_number;

  -- 7. invoice line items (snapshotted)
  insert into public.invoice_items (
    invoice_id, item_type, name_snapshot, unit_price, quantity, total_price, sort_order
  )
  select v_invoice_id, 'GAMING',
         coalesce(v_session.pricing_plan_snapshot ->> 'name', 'Gaming') || ' — ' || v_resource.name,
         v_gaming, 1, v_gaming, 0
  where v_gaming > 0;

  insert into public.invoice_items (
    invoice_id, item_type, name_snapshot, unit_price, quantity, total_price, sort_order
  )
  select v_invoice_id, si.item_type, si.name_snapshot, si.unit_price, si.quantity, si.total_price,
         row_number() over (order by si.created_at)
  from public.session_items si
  where si.session_id = p_session_id;

  -- 8. payment
  if p_payment_method is not null and v_total > 0 then
    insert into public.payments (
      invoice_id, amount, payment_method, payment_status, transaction_reference, paid_at, received_by
    ) values (
      v_invoice_id, v_total, p_payment_method, 'PAID', p_payment_reference, now(), p_acting_user
    );
    v_paid := true;
  end if;

  -- 9. complete linked booking
  if v_session.booking_id is not null then
    update public.bookings set status = 'COMPLETED', updated_at = now()
    where id = v_session.booking_id;
  end if;

  -- 10. release resource (trigger refreshes current_status)

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'session_id', p_session_id,
    'duration_seconds', v_duration,
    'gaming_amount', v_gaming,
    'items_amount', v_items_amt,
    'services_amount', v_services_amt,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'tax_amount', v_tax,
    'total_amount', v_total,
    'paid', v_paid
  );
end;
$$;

-- -------------------------------------------------------------
-- 7. Booking check-in uses the station's default plan
-- -------------------------------------------------------------
create or replace function public.admin_check_in_booking(
  p_booking_id uuid,
  p_acting_user uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_booking record;
  v_customer_id uuid;
  v_plan_id uuid;
  v_session_id uuid;
begin
  select * into v_booking from public.bookings
  where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  v_customer_id := public.admin_find_or_create_customer(
    v_booking.customer_name, v_booking.customer_mobile, null, p_acting_user
  );

  -- the station's default plan first (same rule as the public price shown),
  -- otherwise the cheapest active plan for its type
  select pp.id into v_plan_id
  from public.pricing_plans pp
  join public.resources r on r.id = v_booking.resource_id
  where pp.active
    and (pp.id = r.default_pricing_plan_id
      or (pp.resource_type = r.type))
  order by (pp.id = r.default_pricing_plan_id) desc, pp.price asc
  limit 1;

  if v_plan_id is null then
    raise exception 'NO_PRICING_PLAN';
  end if;

  v_session_id := public.admin_start_session(
    v_customer_id, v_booking.resource_id, v_plan_id,
    now(), v_booking.duration_minutes, p_booking_id, v_booking.notes, p_acting_user
  );

  return v_session_id;
end;
$$;

-- -------------------------------------------------------------
-- 8. Estimates follow the cafe rounding policy (same as the bill)
-- -------------------------------------------------------------
create or replace function public.estimate_booking_amount(
  p_resource_id uuid,
  p_duration_minutes integer
)
returns numeric
language sql stable security definer set search_path = public
as $$
  with plan as (
    select pp.billing_type, pp.price, pp.duration_minutes
    from public.pricing_plans pp
    join public.resources r on r.id = p_resource_id
    where pp.active
      and (pp.id = r.default_pricing_plan_id
        or (r.default_pricing_plan_id is null and pp.resource_type = r.type))
    order by (pp.id = r.default_pricing_plan_id) desc, pp.price asc
    limit 1
  ),
  billable as (
    select greatest(
      case s.billing_mode
        when 'ROUND_UP_15' then ceil(p_duration_minutes / 15.0) * 15
        when 'ROUND_UP_30' then ceil(p_duration_minutes / 30.0) * 30
        when 'ROUND_UP_60' then ceil(p_duration_minutes / 60.0) * 60
        else p_duration_minutes
      end,
      coalesce(s.min_billing_minutes, 0),
      1
    )::numeric as m
    from public.settings s where s.id = 'default'
  )
  select case
    when p.billing_type is null then null
    when p.billing_type = 'HOURLY' then round(p.price * b.m / 60.0, 2)
    when p.billing_type = 'PER_MINUTE' then round(p.price * b.m, 2)
    when p.billing_type = 'FIXED' then p.price
    when p.billing_type = 'PACKAGE' then
      case
        when p.duration_minutes is null or b.m <= p.duration_minutes then p.price
        else round(p.price + (b.m - p.duration_minutes) * (p.price / p.duration_minutes), 2)
      end
    else null
  end
  from plan p cross join billable b;
$$;

-- -------------------------------------------------------------
-- 9. Income & expense ledger
-- -------------------------------------------------------------
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('INCOME', 'EXPENSE')),
  category text not null check (length(btrim(category)) between 1 and 60),
  amount numeric(12,2) not null check (amount > 0),
  entry_date date not null,
  payment_method text check (payment_method in ('CASH', 'UPI', 'CARD', 'OTHER')),
  description text check (description is null or length(description) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ledger_entries_date_idx on public.ledger_entries(entry_date desc);
create index if not exists ledger_entries_type_idx on public.ledger_entries(entry_type, entry_date);

drop trigger if exists ledger_entries_updated_at on public.ledger_entries;
create trigger ledger_entries_updated_at
  before update on public.ledger_entries
  for each row execute function public.set_updated_at();

alter table public.ledger_entries enable row level security;
drop policy if exists "ledger: managers read" on public.ledger_entries;
create policy "ledger: managers read"
  on public.ledger_entries for select
  using (public.my_role() in ('ADMIN', 'MANAGER'));
drop policy if exists "ledger: managers write" on public.ledger_entries;
create policy "ledger: managers write"
  on public.ledger_entries for all
  using (public.my_role() in ('ADMIN', 'MANAGER'))
  with check (public.my_role() in ('ADMIN', 'MANAGER'));

grant select, insert, update, delete on public.ledger_entries to authenticated;
grant all on public.ledger_entries to service_role;

-- -------------------------------------------------------------
-- 10. Function ACLs (server-only)
-- -------------------------------------------------------------
revoke execute on function public.admin_find_or_create_customer(text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_start_session(uuid, uuid, uuid, timestamptz, integer, uuid, text, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.admin_set_session_price(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.admin_set_session_customer(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_check_in_booking(uuid, uuid) from public, anon, authenticated;

grant execute on function public.admin_find_or_create_customer(text, text, text, uuid) to service_role;
grant execute on function public.admin_start_session(uuid, uuid, uuid, timestamptz, integer, uuid, text, uuid, numeric, text, text) to service_role;
grant execute on function public.admin_set_session_price(uuid, numeric) to service_role;
grant execute on function public.admin_set_session_customer(uuid, text, text, uuid) to service_role;
grant execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid) to service_role;
grant execute on function public.admin_check_in_booking(uuid, uuid) to service_role;
grant execute on function public.estimate_booking_amount(uuid, integer) to anon, authenticated, service_role;

-- PostgREST: pick up the new function signatures immediately
notify pgrst, 'reload schema';

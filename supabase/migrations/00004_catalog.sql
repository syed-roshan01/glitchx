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

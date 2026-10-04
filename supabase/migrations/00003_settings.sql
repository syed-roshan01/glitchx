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

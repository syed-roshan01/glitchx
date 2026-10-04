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

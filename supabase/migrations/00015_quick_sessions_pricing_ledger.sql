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

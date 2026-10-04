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

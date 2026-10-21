-- =============================================================
-- 00019 — Multi-station bills (session groups)
--
--  One customer group can play several stations (pool + PS5) and
--  pays ONE bill:
--    * sessions.parent_id links companion stations to the lead session
--    * admin_add_station() adds a station to a running bill (its own
--      timer + plan; the customer/guest details are copied)
--    * admin_end_session_and_invoice() ends the WHOLE group and writes
--      ONE invoice with a gaming line per station and every station's
--      items. Each session row keeps its own amounts (so per-resource
--      revenue reports stay correct).
--
--  p_billing gains `gaming_lines`: [{session_id, amount}, …]. Without
--  it, `gaming_amount` applies to the lead session alone (backward
--  compatible — single-station bills behave exactly as before).
--
-- Safe to run once on the live database.
-- =============================================================

alter table public.sessions
  add column if not exists parent_id uuid references public.sessions(id) on delete set null;

create index if not exists sessions_parent_id_idx on public.sessions (parent_id);

-- -------------------------------------------------------------
-- admin_add_station: add another station to a running bill
-- -------------------------------------------------------------
create or replace function public.admin_add_station(
  p_parent_id uuid,
  p_resource_id uuid,
  p_pricing_plan_id uuid default null,
  p_expected_minutes integer default null,
  p_custom_price numeric default null,
  p_acting_user uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_parent record;
  v_root_id uuid;
  v_res record;
  v_plan_id uuid;
  v_sid uuid;
begin
  select * into v_parent from public.sessions where id = p_parent_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_parent.status not in ('ACTIVE', 'PAUSED') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  -- normalize to the lead session (groups are one level deep)
  v_root_id := coalesce(v_parent.parent_id, v_parent.id);

  select * into v_res from public.resources where id = p_resource_id and active;
  if not found then
    raise exception 'RESOURCE_NOT_FOUND';
  end if;

  -- plan: explicit > the station's default > cheapest for its type
  v_plan_id := p_pricing_plan_id;
  if v_plan_id is null then
    select pp.id into v_plan_id
    from public.pricing_plans pp
    join public.resources r on r.id = p_resource_id
    where pp.active
      and (pp.id = r.default_pricing_plan_id or pp.resource_type = r.type)
    order by (pp.id = r.default_pricing_plan_id) desc, pp.price asc
    limit 1;
  end if;
  if v_plan_id is null then
    raise exception 'NO_PRICING_PLAN';
  end if;

  -- same customer / walk-in details as the lead session; starts NOW with
  -- its own timer (RESOURCE_BUSY comes from the double-booking constraint)
  v_sid := public.admin_start_session(
    v_parent.customer_id,
    p_resource_id,
    v_plan_id,
    now(),
    p_expected_minutes,
    null,
    'Added to the bill of session ' || v_root_id,
    p_acting_user,
    p_custom_price,
    v_parent.guest_name,
    v_parent.guest_mobile
  );

  update public.sessions set parent_id = v_root_id where id = v_sid;
  return v_sid;
end;
$$;

revoke execute on function public.admin_add_station(uuid, uuid, uuid, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.admin_add_station(uuid, uuid, uuid, integer, numeric, uuid) to service_role;

-- -------------------------------------------------------------
-- admin_end_session_and_invoice: ends the WHOLE group, one invoice
-- -------------------------------------------------------------
drop function if exists public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid, timestamptz);

create or replace function public.admin_end_session_and_invoice(
  p_session_id uuid,
  p_billing jsonb,
  p_discount_type text default null,
  p_discount_value numeric default 0,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_acting_user uuid default null,
  p_end_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session record;
  v_member record;
  v_root_id uuid;
  v_root_end timestamptz;
  v_root_duration integer := 0;
  v_settings record;
  v_gaming_lines jsonb;
  v_line numeric;
  v_lines jsonb := '[]'::jsonb;
  v_gaming numeric := 0;
  v_items_amt numeric := 0;
  v_services_amt numeric := 0;
  v_m_items numeric;
  v_m_services numeric;
  v_paused_total numeric;
  v_duration integer;
  v_subtotal numeric;
  v_discount numeric;
  v_tax numeric;
  v_rounding numeric;
  v_total numeric;
  v_invoice_id uuid;
  v_invoice_number text;
  v_resource_names text := '';
  v_first boolean := true;
  v_session_ids uuid[] := '{}';
  v_paid boolean := false;
begin
  -- 1. lock & validate the requested session, resolve the group lead
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status not in ('ACTIVE', 'PAUSED') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  v_root_id := coalesce(v_session.parent_id, v_session.id);
  select * into v_session from public.sessions where id = v_root_id for update;

  select * into v_settings from public.settings where id = 'default';

  -- frozen billable end: the moment staff pressed "End session" —
  -- the whole group stops at this same instant
  v_root_end := least(
    greatest(coalesce(p_end_at, now()), coalesce(v_session.actual_start_time, now())),
    now()
  );

  -- the duration guard keeps talking about the lead session (60s tolerance)
  v_paused_total := coalesce(v_session.total_paused_seconds, 0)
    + case when v_session.paused_at is not null
           then extract(epoch from (v_root_end - v_session.paused_at)) else 0 end;
  v_paused_total := least(v_paused_total, extract(epoch from (v_root_end - v_session.actual_start_time)));
  v_root_duration := greatest(floor(extract(epoch from (v_root_end - v_session.actual_start_time)) - v_paused_total)::int, 0);

  if abs(v_root_duration - coalesce((p_billing ->> 'duration_seconds')::numeric, v_root_duration)) > 60 then
    raise exception 'BILLING_MISMATCH';
  end if;

  v_gaming_lines := coalesce(p_billing -> 'gaming_lines', '[]'::jsonb);

  -- 2. every station in the group: freeze its own timer and amounts
  for v_member in
    select s.*, r.name as resource_name
    from public.sessions s
    join public.resources r on r.id = s.resource_id
    where (s.id = v_root_id or s.parent_id = v_root_id)
      and s.status in ('ACTIVE', 'PAUSED')
    order by (s.id = v_root_id) desc, s.created_at
    for update of s
  loop
    -- the per-station charge: its line from the engine; without lines
    -- (single-station callers) the whole gaming_amount belongs to the lead
    v_line := coalesce(
      (select (el ->> 'amount')::numeric
       from jsonb_array_elements(v_gaming_lines) el
       where el ->> 'session_id' = v_member.id::text),
      case when v_member.id = v_root_id then coalesce((p_billing ->> 'gaming_amount')::numeric, 0) else 0 end
    );

    declare
      v_m_end timestamptz;
    begin
      v_m_end := least(
        greatest(coalesce(p_end_at, now()), coalesce(v_member.actual_start_time, now())),
        now()
      );
      v_paused_total := coalesce(v_member.total_paused_seconds, 0)
        + case when v_member.paused_at is not null
               then extract(epoch from (v_m_end - v_member.paused_at)) else 0 end;
      v_paused_total := least(v_paused_total, extract(epoch from (v_m_end - v_member.actual_start_time)));
      v_duration := greatest(floor(extract(epoch from (v_m_end - v_member.actual_start_time)) - v_paused_total)::int, 0);

      select
        coalesce(sum(total_price) filter (where item_type in ('FOOD', 'DRINK', 'OTHER')), 0),
        coalesce(sum(total_price) filter (where item_type in ('SERVICE', 'GAME')), 0)
      into v_m_items, v_m_services
      from public.session_items where session_id = v_member.id;

      v_items_amt := v_items_amt + v_m_items;
      v_services_amt := v_services_amt + v_m_services;
      v_gaming := v_gaming + v_line;
      v_session_ids := v_session_ids || v_member.id;

      -- each session keeps its own gross amounts → per-resource reports correct
      update public.sessions
      set status = 'COMPLETED',
          end_time = v_m_end,
          total_paused_seconds = floor(v_paused_total)::int,
          duration_seconds = v_duration,
          gaming_amount = v_line,
          subtotal = round(v_line + v_m_items + v_m_services, 2),
          total_amount = round(v_line + v_m_items + v_m_services, 2),
          payment_status = 'PENDING',
          paused_at = null,
          updated_at = now()
      where id = v_member.id;

      if v_member.id = v_root_id then
        v_root_duration := v_duration;
      end if;

      -- gaming line for the invoice (per station)
      if v_line > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'name', coalesce(v_member.pricing_plan_snapshot ->> 'name', 'Gaming') || ' — ' || v_member.resource_name,
          'amount', v_line
        ));
      end if;

      v_resource_names := v_resource_names || case when v_first then '' else ' + ' end || v_member.resource_name;
      v_first := false;
    end;
  end loop;

  -- 3. totals — arithmetic is authoritative here
  v_subtotal := round(v_gaming + v_items_amt + v_services_amt, 2);

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
  -- money rounding add-on (₹5 steps) computed by the engine
  v_rounding := coalesce((p_billing ->> 'rounding_amount')::numeric, 0);
  v_total := v_total + v_rounding;

  if p_payment_method is not null and p_payment_method not in ('CASH', 'UPI', 'CARD', 'OTHER') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- 4. ONE invoice for the whole group
  insert into public.invoices (
    session_id, customer_id, customer_name, customer_mobile, resource_name,
    session_start, session_end, duration_minutes,
    gaming_amount, items_amount, services_amount,
    discount_amount, discount_type, discount_value,
    tax_name, tax_rate, tax_amount,
    subtotal, total_amount, status, created_by
  ) values (
    v_root_id,
    v_session.customer_id,
    coalesce(
      (select name from public.customers where id = v_session.customer_id),
      nullif(btrim(v_session.guest_name), ''),
      'Walk-in'
    ),
    coalesce(
      (select mobile from public.customers where id = v_session.customer_id),
      nullif(btrim(v_session.guest_mobile), ''),
      ''
    ),
    v_resource_names,
    v_session.actual_start_time, v_root_end, greatest(round(v_root_duration / 60.0), 0)::int,
    v_gaming, v_items_amt, v_services_amt,
    v_discount, p_discount_type,
    case when p_discount_type is not null then coalesce(p_discount_value, 0) else v_session.discount_value end,
    case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_name end,
    case when coalesce(v_settings.tax_enabled, false) then v_settings.tax_rate end,
    v_tax,
    v_subtotal, v_total,
    case when p_payment_method is not null or v_total = 0 then 'PAID' else 'ISSUED' end,
    p_acting_user
  )
  returning id, invoice_number into v_invoice_id, v_invoice_number;

  -- one gaming line per station
  insert into public.invoice_items (
    invoice_id, item_type, name_snapshot, unit_price, quantity, total_price, sort_order
  )
  select v_invoice_id, 'GAMING', el ->> 'name', (el ->> 'amount')::numeric, 1,
         (el ->> 'amount')::numeric, (row_number() over ())::int
  from jsonb_array_elements(v_lines) el;

  -- every station's items
  insert into public.invoice_items (
    invoice_id, item_type, name_snapshot, unit_price, quantity, total_price, sort_order
  )
  select v_invoice_id, si.item_type, si.name_snapshot, si.unit_price, si.quantity, si.total_price,
         100 + row_number() over (order by si.created_at)
  from public.session_items si
  where si.session_id = any (v_session_ids);

  -- 5. one payment for the group
  if p_payment_method is not null and v_total > 0 then
    insert into public.payments (
      invoice_id, amount, payment_method, payment_status, transaction_reference, paid_at, received_by
    ) values (
      v_invoice_id, v_total, p_payment_method, 'PAID', p_payment_reference, now(), p_acting_user
    );
    v_paid := true;
  end if;

  -- the whole group's payment status follows the invoice
  update public.sessions
  set payment_status = case when v_paid or v_total = 0 then 'PAID' else 'PENDING' end
  where id = any (v_session_ids);

  -- 6. complete the lead's booking
  if v_session.booking_id is not null then
    update public.bookings set status = 'COMPLETED', updated_at = now()
    where id = v_session.booking_id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'session_id', v_root_id,
    'sessions', to_jsonb(v_session_ids),
    'duration_seconds', v_root_duration,
    'gaming_amount', v_gaming,
    'items_amount', v_items_amt,
    'services_amount', v_services_amt,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'tax_amount', v_tax,
    'rounding_amount', v_rounding,
    'total_amount', v_total,
    'paid', v_paid
  );
end;
$$;

revoke execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid, timestamptz) to service_role;

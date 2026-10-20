-- =============================================================
-- 00017 — Frozen end-time for session billing
--
--  admin_end_session_and_invoice() gains `p_end_at`: the billable
--  end moment captured when staff click "End session" (before
--  filling the payment form). The timer, the confirmation screen
--  and the invoice all bill the SAME instant — amounts never drift
--  while the form is open, and a slow confirm can no longer trip
--  the BILLING_MISMATCH guard. `p_end_at` is clamped to
--  [actual_start_time, now()]; callers without it behave as before.
--
--  Body is the 00015 version (walk-in names, guest mobile fallback)
--  plus the frozen-end change.
--
-- Safe to run once on the live database.
-- =============================================================

drop function if exists public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid);

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
  v_cust_name text;
  v_cust_mobile text;
  v_resource record;
  v_settings record;
  v_end timestamptz;
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

  -- frozen billable end: the moment staff pressed "End session",
  -- clamped to [start, now] so it can never be abused
  v_end := least(
    greatest(coalesce(p_end_at, now()), coalesce(v_session.actual_start_time, now())),
    now()
  );

  -- 2. authoritative duration from DB timestamps
  v_paused_total := coalesce(v_session.total_paused_seconds, 0)
    + case when v_session.paused_at is not null
           then extract(epoch from (v_end - v_session.paused_at)) else 0 end;
  -- a frozen end can land before a pause began; never bill paused time
  v_paused_total := least(v_paused_total, extract(epoch from (v_end - v_session.actual_start_time)));
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

  -- 5. finalize session (end_time = the frozen end moment)
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

revoke execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_end_session_and_invoice(uuid, jsonb, text, numeric, text, text, uuid, timestamptz) to service_role;

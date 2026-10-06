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

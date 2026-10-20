-- =============================================================
-- GlitchX UPGRADE: WhatsApp receipt relay + frozen end-time
--
-- ONE-PASTE upgrade for an EXISTING database that already ran
-- supabase/setup.sql (or migrations 00001..00015).
-- Identical to migrations 00016 + 00017 concatenated.
--
-- HOW TO USE
--   1. Supabase project -> SQL Editor -> New query
--   2. Paste this entire file and click RUN
--   3. Success = "Success. No rows returned"
--
-- What it adds:
--   * whatsapp_state + whatsapp_messages + auto-enqueue trigger
--     (new invoices are queued for WhatsApp delivery automatically)
--   * admin_end_session_and_invoice() gains a FROZEN end moment:
--     the timer stops when you press "End session" and the invoice
--     bills exactly that instant.
--   * Scheduled sessions that come due late (page loads after a
--     power cut) bill from their SCHEDULED time, not activation time.
-- =============================================================
-- =============================================================
-- 00016 â€” WhatsApp invoice relay + scheduled-session backdating
--
--  1. activate_due_sessions(): a scheduled session that becomes due
--     (page load after an outage/power cut, etc.) is backdated to its
--     SCHEDULED time for billing, not stamped at activation time.
--  2. whatsapp_state: single-row config + relay heartbeat (connection
--     state, linked phone number, current QR payload).
--  3. whatsapp_messages: the send queue / log. New invoices are
--     auto-enqueued by trigger when auto-send is on and the customer
--     has a mobile number. The local relay (whatsapp-relay/) drains
--     this queue and delivers invoice PDFs over WhatsApp (WhatsApp
--     Web / multi-device protocol). Queued messages survive power
--     cuts and are sent when the relay comes back online.
--
-- Safe to run once on the live database (idempotent where possible).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Scheduled sessions bill from their scheduled time
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
    select id, resource_id, scheduled_start_time from public.sessions
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
          -- backdate to the scheduled moment so a late activation
          -- (outage, nobody watching) never loses billable time
          actual_start_time = coalesce(actual_start_time, s.scheduled_start_time, now()),
          updated_at = now()
      where id = s.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- -------------------------------------------------------------
-- 2. Relay state + config (single row)
-- -------------------------------------------------------------
create table if not exists public.whatsapp_state (
  id text primary key default 'default',
  enabled boolean not null default false,
  auto_send boolean not null default true,
  send_delay_ms integer not null default 2500 check (send_delay_ms between 0 and 60000),
  connected boolean not null default false,
  phone text,
  qr text,
  last_seen timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_state (id) values ('default')
on conflict (id) do nothing;

drop trigger if exists whatsapp_state_updated_at on public.whatsapp_state;
create trigger whatsapp_state_updated_at
  before update on public.whatsapp_state
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- 3. Outgoing message queue / log
-- -------------------------------------------------------------
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete cascade,
  to_mobile text not null check (length(to_mobile) between 7 and 20),
  caption text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0,
  last_error text,
  wa_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_status_idx
  on public.whatsapp_messages(status, created_at);
create index if not exists whatsapp_messages_invoice_idx
  on public.whatsapp_messages(invoice_id);

drop trigger if exists whatsapp_messages_updated_at on public.whatsapp_messages;
create trigger whatsapp_messages_updated_at
  before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- 4. Auto-enqueue new invoices
-- -------------------------------------------------------------
create or replace function public.enqueue_invoice_whatsapp()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_enabled boolean;
  v_auto boolean;
  v_mobile text;
  v_cafe text;
begin
  select enabled, auto_send into v_enabled, v_auto
  from public.whatsapp_state where id = 'default';
  if not coalesce(v_enabled, false) or not coalesce(v_auto, false) then
    return new;
  end if;

  -- customer mobile, falling back to the session's walk-in guest mobile
  select coalesce(
    nullif(public.mobile_digits(c.mobile), ''),
    nullif(public.mobile_digits(s.guest_mobile), '')
  )
  into v_mobile
  from (select 1) _
  left join public.customers c on c.id = new.customer_id
  left join public.sessions s on s.id = new.session_id;
  if v_mobile is null then
    return new;
  end if;

  select cafe_name into v_cafe from public.settings where id = 'default';

  insert into public.whatsapp_messages (invoice_id, to_mobile, caption)
  values (
    new.id,
    v_mobile,
    format(
      E'Thank you for visiting %s!\n\nReceipt *%s* Â· Total %s%s',
      coalesce(v_cafe, 'the cafe'),
      new.invoice_number,
      coalesce(to_char(new.total_amount, 'FM999990.00'), '0'),
      case when new.status = 'PAID' then E'\nPaid in full âœ“' else '' end
    )
  );
  return new;
end;
$$;
revoke execute on function public.enqueue_invoice_whatsapp() from public, anon, authenticated;

drop trigger if exists invoices_enqueue_whatsapp on public.invoices;
create trigger invoices_enqueue_whatsapp
  after insert on public.invoices
  for each row execute function public.enqueue_invoice_whatsapp();

-- -------------------------------------------------------------
-- 5. Grants + RLS (mirrors 00015 ledger_entries)
-- -------------------------------------------------------------
alter table public.whatsapp_state enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists "whatsapp_state: managers read" on public.whatsapp_state;
create policy "whatsapp_state: managers read"
  on public.whatsapp_state for select
  using (public.my_role() in ('ADMIN', 'MANAGER'));

drop policy if exists "whatsapp_messages: managers read" on public.whatsapp_messages;
create policy "whatsapp_messages: managers read"
  on public.whatsapp_messages for select
  using (public.my_role() in ('ADMIN', 'MANAGER'));

grant select on public.whatsapp_state to authenticated;
grant all on public.whatsapp_state to service_role;
grant select on public.whatsapp_messages to authenticated;
grant all on public.whatsapp_messages to service_role;
revoke all on public.whatsapp_state from anon;
revoke all on public.whatsapp_messages from anon;

-- =============================================================
-- 00017 â€” Frozen end-time for session billing
--
--  admin_end_session_and_invoice() gains `p_end_at`: the billable
--  end moment captured when staff click "End session" (before
--  filling the payment form). The timer, the confirmation screen
--  and the invoice all bill the SAME instant â€” amounts never drift
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
         coalesce(v_session.pricing_plan_snapshot ->> 'name', 'Gaming') || ' â€” ' || v_resource.name,
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

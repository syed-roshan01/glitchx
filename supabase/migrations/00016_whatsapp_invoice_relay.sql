-- =============================================================
-- 00016 — WhatsApp invoice relay + scheduled-session backdating
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
      E'Thank you for visiting %s!\n\nReceipt *%s* · Total %s%s',
      coalesce(v_cafe, 'the cafe'),
      new.invoice_number,
      coalesce(to_char(new.total_amount, 'FM999990.00'), '0'),
      case when new.status = 'PAID' then E'\nPaid in full ✓' else '' end
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

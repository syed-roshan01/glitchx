-- =============================================================
-- 00007 — Bookings and waitlist
-- =============================================================

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_mobile text not null,
  resource_id uuid not null references public.resources(id) on delete restrict,
  booking_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  estimated_amount numeric(10,2),
  source text not null default 'ADMIN' check (source in ('PUBLIC', 'ADMIN')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_check check (end_time > start_time)
);

create index bookings_date_idx on public.bookings(booking_date desc);
create index bookings_resource_idx on public.bookings(resource_id, start_time);
create index bookings_status_idx on public.bookings(status);
create index bookings_mobile_idx on public.bookings(customer_mobile);

alter table public.sessions
  add constraint sessions_booking_fk
  foreign key (booking_id) references public.bookings(id) on delete set null;

-- CRITICAL: never allow two overlapping live bookings per resource.
-- Exclusion constraint enforced at the database level (race-safe).
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  )
  where (status in ('PENDING', 'CONFIRMED', 'CHECKED_IN'));

-- -------------------------------------------------------------
-- Human-readable booking code: GC-1024
-- -------------------------------------------------------------
create sequence public.booking_code_seq start 1000;

create or replace function public.set_booking_code()
returns trigger
language plpgsql
as $$
begin
  if new.booking_code is null then
    new.booking_code := 'GC-' || nextval('public.booking_code_seq');
  end if;
  return new;
end;
$$;

create trigger bookings_set_code
  before insert on public.bookings
  for each row execute function public.set_booking_code();

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Waitlist / queue
-- -------------------------------------------------------------
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_mobile text not null,
  resource_type text,
  resource_id uuid references public.resources(id) on delete set null,
  requested_duration_minutes integer,
  position integer not null default 1,
  status text not null default 'WAITING'
    check (status in ('WAITING', 'NOTIFIED', 'ASSIGNED', 'CANCELLED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  served_at timestamptz
);

create index waitlist_status_pos_idx on public.waitlist(status, position);
create index waitlist_mobile_idx on public.waitlist(customer_mobile);

-- position assigned on insert (next in line)
create or replace function public.set_waitlist_position()
returns trigger
language plpgsql
as $$
declare
  next_pos integer;
begin
  select coalesce(max(position), 0) + 1 into next_pos
  from public.waitlist where status = 'WAITING';
  new.position := next_pos;
  return new;
end;
$$;

create trigger waitlist_set_position
  before insert on public.waitlist
  for each row execute function public.set_waitlist_position();

-- when an entry leaves the WAITING state, shift the rest up
create or replace function public.shift_waitlist()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'WAITING' and new.status <> 'WAITING' then
    new.served_at := now();
    update public.waitlist
      set position = position - 1, updated_at = now()
      where status = 'WAITING' and position > old.position;
  end if;
  return new;
end;
$$;

create trigger waitlist_shift
  before update on public.waitlist
  for each row execute function public.shift_waitlist();

create trigger waitlist_updated_at
  before update on public.waitlist
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- RLS: no direct anon access — public booking/waitlist creation
-- goes through SECURITY DEFINER RPCs (00010) that validate input.
-- -------------------------------------------------------------
alter table public.bookings enable row level security;

create policy "bookings: staff read"
  on public.bookings for select
  using (public.is_staff());
create policy "bookings: staff insert"
  on public.bookings for insert
  with check (public.is_staff());
create policy "bookings: staff update"
  on public.bookings for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "bookings: admin delete"
  on public.bookings for delete
  using (public.is_admin());

alter table public.waitlist enable row level security;

create policy "waitlist: staff read"
  on public.waitlist for select
  using (public.is_staff());
create policy "waitlist: staff insert"
  on public.waitlist for insert
  with check (public.is_staff());
create policy "waitlist: staff update"
  on public.waitlist for update
  using (public.is_staff())
  with check (public.is_staff());
create policy "waitlist: admin delete"
  on public.waitlist for delete
  using (public.is_admin());

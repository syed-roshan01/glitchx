-- =============================================================
-- 00002 — Profiles, roles and core helpers
-- =============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Staff',
  email text,
  role text not null default 'STAFF' check (role in ('ADMIN', 'MANAGER', 'STAFF')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

-- -------------------------------------------------------------
-- Role helpers (security definer so RLS policies on other tables
-- can resolve the caller's role without recursion on profiles).
-- -------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('ADMIN', 'MANAGER', 'STAFF'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() = 'ADMIN', false);
$$;

-- -------------------------------------------------------------
-- Generic updated_at trigger
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Auto-create a profile whenever a new auth user is created.
-- New users default to STAFF; the first admin is claimed via
-- public.claim_first_admin() during onboarding.
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    'STAFF'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles: self read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: staff read all"
  on public.profiles for select
  using (public.is_staff());

create policy "profiles: admin full control"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================
-- GlitchX — DATABASE RESET
--
-- Use this ONLY if a previous setup attempt failed partway or
-- you want to wipe all cafe data and start over. It removes every
-- object this app creates in the public schema (tables, functions,
-- triggers, policies, seed data). It does NOT touch Supabase auth
-- users, storage, or the supabase_realtime publication itself.
--
-- After running this, run supabase/setup.sql again.
-- =============================================================

-- remove the trigger Supabase's auth.users carries (recreated by setup)
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;

-- drop and recreate the public schema (removes all app tables,
-- functions, policies, sequences and their publication entries)
drop schema if exists public cascade;
create schema public;

-- restore Supabase's standard schema-level grants
grant usage, create on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- restore Supabase's standard default privileges for new objects
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

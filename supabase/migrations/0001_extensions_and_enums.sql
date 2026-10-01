-- =====================================================================
-- FILE: supabase/migrations/0001_extensions_and_enums.sql
-- PERS Telecom Security - Incident Management & RRT Dispatch
-- Phase 1 / Step 1 of 10: extensions, private schema, enum types
--
-- Safe to run more than once (idempotent).
-- Run in: Supabase Dashboard > SQL Editor (or `npx supabase db push`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------
create schema if not exists extensions;

-- pgcrypto: password hashing for demo users, uuid helpers
create extension if not exists pgcrypto with schema extensions;

-- pg_trgm: fast type-ahead search on tower number / site name
create extension if not exists pg_trgm with schema extensions;

-- pg_net: lets the database call the push-notification Edge Function.
-- Wrapped so a missing/unavailable extension never blocks the install.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net could not be enabled automatically (%). Enable it in Dashboard > Database > Extensions.', sqlerrm;
end
$$;

-- pg_cron: runs the 30-second escalation sweep inside the database.
-- Wrapped so a missing/unavailable extension never blocks the install.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron could not be enabled automatically (%). Enable it in Dashboard > Database > Extensions, then re-run 0009.', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Private schema for internal functions (not exposed through the API)
-- ---------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Enum types
-- ---------------------------------------------------------------------
do $$
begin
  create type public.role_code as enum
    ('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'RRT_MEMBER');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.team_status as enum
    ('AVAILABLE', 'ASSIGNED', 'REACHED', 'OFFLINE');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.tower_status as enum
    ('ACTIVE', 'INACTIVE', 'MAINTENANCE');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.incident_status as enum
    ('OPEN', 'ASSIGNED', 'REACHED', 'RESOLVED', 'CANCELLED');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.dispatch_state as enum
    ('OFFERING', 'EXHAUSTED', 'DONE');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.incident_source as enum
    ('MAP_MENU', 'CREATE_FORM', 'API');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.assignment_status as enum
    ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.question_type as enum
    ('YES_NO', 'RATING', 'TEXT', 'DROPDOWN', 'FILE', 'PHOTO', 'MULTI_SELECT');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.notification_type as enum
    ('INCIDENT_OFFER', 'INCIDENT_ASSIGNED', 'INCIDENT_REACHED',
     'INCIDENT_RESOLVED', 'INCIDENT_EXHAUSTED', 'INCIDENT_CANCELLED',
     'TEAM_OFFLINE', 'SYSTEM');
exception when duplicate_object then null;
end
$$;

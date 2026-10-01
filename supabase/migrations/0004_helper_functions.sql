-- =====================================================================
-- FILE: supabase/migrations/0004_helper_functions.sql
-- PERS Telecom Security - Phase 1 / Step 4 of 10: helper functions
--
-- Role helpers (used by every RLS policy), settings readers, Haversine
-- distance, notification helpers, team release, incident numbering.
-- Safe to run more than once (create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Generic trigger function: keep updated_at current
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they can read public.users even
-- though RLS protects it. They are STABLE so Postgres caches them
-- per statement when wrapped as (select app.user_role()).
-- ---------------------------------------------------------------------
create or replace function app.user_role()
returns public.role_code
language sql
stable
security definer
set search_path = ''
as $$
  select r.code
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = (select auth.uid())
    and u.is_active
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.user_role() in ('SUPER_ADMIN', 'ADMIN', 'OPERATOR'), false)
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.user_role() in ('SUPER_ADMIN', 'ADMIN'), false)
$$;

create or replace function app.is_super()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.user_role() = 'SUPER_ADMIN', false)
$$;

-- Team the signed-in RRT member belongs to (NULL for staff).
create or replace function app.team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.rrt_team_id
  from public.users u
  where u.id = (select auth.uid())
    and u.is_active
$$;

-- True when the request is made with the Supabase secret (service_role) key.
create or replace function app.is_service()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'role', '') = 'service_role'
$$;

-- May the caller act on behalf of this team?
--  * an RRT member acts for their own team
--  * an admin (or the secret key) may act for SIMULATED demo teams only
create or replace function app.can_act_for_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (app.user_role() = 'RRT_MEMBER' and app.team_id() is not null and app.team_id() = p_team_id)
    or ((app.is_admin() or app.is_service())
        and exists (select 1 from public.rrt_teams t where t.id = p_team_id and t.is_simulated))
$$;

-- ---------------------------------------------------------------------
-- Settings readers
-- ---------------------------------------------------------------------
create or replace function app.setting_num(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value #>> '{}')::numeric
       from public.settings s
      where s.key = p_key and jsonb_typeof(s.value) = 'number'),
    p_default)
$$;

create or replace function app.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value #>> '{}'
       from public.settings s
      where s.key = p_key and jsonb_typeof(s.value) = 'string'),
    p_default)
$$;

create or replace function app.report_tz()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.setting_text('report_timezone', 'Asia/Kolkata')
$$;

-- ---------------------------------------------------------------------
-- Haversine great-circle distance in kilometres (Earth radius 6371 km)
-- ---------------------------------------------------------------------
create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select 2 * 6371.0 * asin(least(1.0, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2))
           * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- ---------------------------------------------------------------------
-- Incident numbering: INC-<year>-<6 digit sequence>
-- ---------------------------------------------------------------------
create or replace function app.next_incident_number()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'INC-'
      || to_char(now() at time zone app.report_tz(), 'YYYY')
      || '-'
      || lpad(nextval('public.incident_number_seq')::text, 6, '0')
$$;

-- ---------------------------------------------------------------------
-- Notification helpers
-- ---------------------------------------------------------------------
-- One notification row per active member of the team.
create or replace function app.notify_team(
  p_team_id       uuid,
  p_type          public.notification_type,
  p_incident_id   uuid,
  p_assignment_id uuid,
  p_title         text,
  p_body          text,
  p_payload       jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications
    (user_id, team_id, type, incident_id, assignment_id, title, body, payload)
  select u.id, p_team_id, p_type, p_incident_id, p_assignment_id, p_title, p_body, coalesce(p_payload, '{}'::jsonb)
  from public.users u
  where u.rrt_team_id = p_team_id
    and u.is_active
$$;

-- One notification row per active control-room user (operators and admins).
create or replace function app.notify_staff(
  p_type        public.notification_type,
  p_incident_id uuid,
  p_title       text,
  p_body        text,
  p_payload     jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications
    (user_id, type, incident_id, title, body, payload)
  select u.id, p_type, p_incident_id, p_title, p_body, coalesce(p_payload, '{}'::jsonb)
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.is_active
    and r.code in ('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
$$;

-- ---------------------------------------------------------------------
-- Free a team after an incident ends: AVAILABLE if it is online and its
-- GPS is fresh, otherwise OFFLINE.
-- ---------------------------------------------------------------------
create or replace function app.release_team(p_team_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.rrt_teams t
     set current_incident_id = null,
         stale_alerted = false,
         status = case
                    when t.is_active
                     and t.is_online_enabled
                     and t.last_seen_at is not null
                     and t.last_seen_at >= now() - make_interval(secs => app.setting_num('offline_after_seconds', 45)::double precision)
                    then 'AVAILABLE'::public.team_status
                    else 'OFFLINE'::public.team_status
                  end
   where t.id = p_team_id
$$;

-- ---------------------------------------------------------------------
-- Function privileges: private schema functions are callable only by
-- signed-in users (needed by RLS policies) and the service role.
-- ---------------------------------------------------------------------
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

revoke all on function public.haversine_km(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to authenticated, service_role;

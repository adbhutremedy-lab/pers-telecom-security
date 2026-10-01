-- =====================================================================
-- FILE: supabase/PASTE_1_all_migrations.sql
-- PERS Telecom Security - ALL ten migrations in one file (0001 to 0010).
-- Paste the whole file into Supabase > SQL Editor > New query > Run.
-- It is exactly the ten files in supabase/migrations/ joined in order.
-- Safe to run more than once.
-- =====================================================================

-- >>>>>>>>>> BEGIN 0001_extensions_and_enums.sql >>>>>>>>>>
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

-- <<<<<<<<<< END 0001_extensions_and_enums.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0002_tables.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0002_tables.sql
-- PERS Telecom Security - Phase 1 / Step 2 of 10: tables
--
-- The 14 required tables:
--   roles, users, rrt_teams, rrt_locations, towers, incidents,
--   incident_assignments, custom_forms, custom_questions,
--   incident_answers, incident_photos, notifications, audit_logs, settings
-- Safe to run more than once (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- roles : the four system roles
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id          smallint primary key,
  code        public.role_code not null unique,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- rrt_teams : Rapid Response Teams and their live state
-- (current_incident_id foreign key is added after incidents exists)
-- ---------------------------------------------------------------------
create table if not exists public.rrt_teams (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                       -- e.g. RRT-01
  name                text not null,
  mobile              text,
  vehicle_plate       text,
  vehicle_model       text,
  region              text,
  status              public.team_status not null default 'OFFLINE',
  is_active           boolean not null default true,              -- false = deactivated team
  is_simulated        boolean not null default false,             -- true = demo team driven by Demo Controller
  is_online_enabled   boolean not null default false,             -- the team's own Go Online / Go Offline switch
  home_lat            double precision,                           -- base position (demo reset / seed)
  home_lng            double precision,
  last_lat            double precision,
  last_lng            double precision,
  last_speed_kmh      numeric(6,2),
  last_heading        numeric(5,1),
  last_accuracy_m     numeric(8,2),
  last_seen_at        timestamptz,
  stale_alerted       boolean not null default false,             -- operator already alerted about lost GPS
  current_incident_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint rrt_teams_lat_chk check (last_lat is null or last_lat between -90 and 90),
  constraint rrt_teams_lng_chk check (last_lng is null or last_lng between -180 and 180),
  constraint rrt_teams_home_lat_chk check (home_lat is null or home_lat between -90 and 90),
  constraint rrt_teams_home_lng_chk check (home_lng is null or home_lng between -180 and 180)
);

-- ---------------------------------------------------------------------
-- users : profile row for every Supabase Auth account
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text,
  full_name          text not null,
  phone              text,
  role_id            smallint not null references public.roles (id),
  rrt_team_id        uuid references public.rrt_teams (id) on delete set null,
  is_active          boolean not null default true,
  push_subscriptions jsonb not null default '[]'::jsonb,          -- Web Push subscriptions of the user's devices
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint users_push_subscriptions_array_chk check (jsonb_typeof(push_subscriptions) = 'array')
);

-- ---------------------------------------------------------------------
-- towers : cell sites
-- ---------------------------------------------------------------------
create table if not exists public.towers (
  id           uuid primary key default gen_random_uuid(),
  tower_number text not null unique,
  site_name    text not null,
  lat          double precision not null,
  lng          double precision not null,
  region       text not null,
  status       public.tower_status not null default 'ACTIVE',
  address      text,
  deleted_at   timestamptz,                                       -- soft delete keeps incident history intact
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint towers_lat_chk check (lat between -90 and 90),
  constraint towers_lng_chk check (lng between -180 and 180)
);

-- ---------------------------------------------------------------------
-- custom_forms : reusable resolution form templates
-- ---------------------------------------------------------------------
create table if not exists public.custom_forms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  is_default  boolean not null default false,
  version     integer not null default 1,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- custom_questions : questions inside a form
-- ---------------------------------------------------------------------
create table if not exists public.custom_questions (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references public.custom_forms (id) on delete cascade,
  position     integer not null,
  label        text not null,
  help_text    text,
  type         public.question_type not null,
  is_required  boolean not null default false,
  scale_min    integer,                                           -- RATING only
  scale_max    integer,                                           -- RATING only (1-5, 1-10 or custom)
  options      jsonb not null default '[]'::jsonb,                -- DROPDOWN / MULTI_SELECT choices (array of strings)
  multiline    boolean not null default false,                    -- TEXT only
  min_files    smallint not null default 0,                       -- PHOTO / FILE only
  max_files    smallint not null default 5,                       -- PHOTO / FILE only
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint custom_questions_form_position_uq
    unique (form_id, position) deferrable initially deferred,
  constraint custom_questions_options_chk check (jsonb_typeof(options) = 'array'),
  constraint custom_questions_rating_chk check (
    type <> 'RATING'
    or (scale_min is not null and scale_max is not null and scale_min < scale_max)
  ),
  constraint custom_questions_choice_chk check (
    type not in ('DROPDOWN', 'MULTI_SELECT') or jsonb_array_length(options) > 0
  ),
  constraint custom_questions_files_chk check (min_files >= 0 and max_files >= min_files)
);

-- ---------------------------------------------------------------------
-- incidents : one row per alarm
-- ---------------------------------------------------------------------
create sequence if not exists public.incident_number_seq start with 1 increment by 1;

create table if not exists public.incidents (
  id                   uuid primary key default gen_random_uuid(),
  incident_number      text not null unique,                      -- INC-2026-000001 (set by trigger)
  tower_id             uuid not null references public.towers (id),
  status               public.incident_status not null default 'OPEN',
  dispatch_state       public.dispatch_state not null default 'OFFERING',
  dispatch_round       smallint not null default 1,
  source               public.incident_source not null default 'MAP_MENU',
  region               text,                                      -- copied from the tower at creation
  triggered_by         uuid references public.users (id) on delete set null,
  triggered_at         timestamptz not null default now(),
  assigned_team_id     uuid references public.rrt_teams (id) on delete set null,
  accepted_at          timestamptz,
  reached_at           timestamptz,
  reached_manually     boolean not null default false,
  resolved_at          timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  last_dispatch_at     timestamptz,
  eta_seconds          integer,
  eta_updated_at       timestamptz,                               -- last time ETA came from Mapbox Directions
  distance_remaining_m integer,                                   -- straight-line (Haversine) metres to the tower
  route_distance_m     integer,                                   -- road metres from Mapbox Directions
  route_geojson        jsonb,                                     -- planned route line (GeoJSON LineString)
  form_id              uuid references public.custom_forms (id) on delete set null,
  notes                text,
  is_demo_seed         boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Duration columns, calculated by the database so reports always agree.
  accept_seconds integer generated always as (
    case when accepted_at is not null
         then (extract(epoch from (accepted_at - triggered_at)))::integer end
  ) stored,                                                       -- triggered -> accepted
  travel_seconds integer generated always as (
    case when reached_at is not null and accepted_at is not null
         then (extract(epoch from (reached_at - accepted_at)))::integer end
  ) stored,                                                       -- accepted -> reached
  response_seconds integer generated always as (
    case when reached_at is not null
         then (extract(epoch from (reached_at - triggered_at)))::integer end
  ) stored,                                                       -- triggered -> reached (time to site)
  onsite_seconds integer generated always as (
    case when resolved_at is not null and reached_at is not null
         then (extract(epoch from (resolved_at - reached_at)))::integer end
  ) stored,                                                       -- reached -> resolved
  resolution_seconds integer generated always as (
    case when resolved_at is not null
         then (extract(epoch from (resolved_at - triggered_at)))::integer end
  ) stored,                                                       -- triggered -> resolved

  constraint incidents_route_geojson_chk check (
    route_geojson is null or jsonb_typeof(route_geojson) = 'object'
  )
);

-- Now that incidents exists, link teams to their current incident.
do $$
begin
  alter table public.rrt_teams
    add constraint rrt_teams_current_incident_fk
    foreign key (current_incident_id) references public.incidents (id) on delete set null;
exception when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------
-- incident_assignments : every offer made to a team (the escalation chain)
-- ---------------------------------------------------------------------
create table if not exists public.incident_assignments (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  team_id         uuid not null references public.rrt_teams (id),
  sequence_no     integer not null,
  round_no        smallint not null default 1,
  distance_km     numeric(9,3) not null,
  status          public.assignment_status not null default 'PENDING',
  manual          boolean not null default false,                 -- true when an operator picked the team
  offered_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  responded_at    timestamptz,
  response_reason text,
  constraint incident_assignments_seq_uq unique (incident_id, sequence_no)
);

-- ---------------------------------------------------------------------
-- rrt_locations : GPS history (one row per ping)
-- ---------------------------------------------------------------------
create table if not exists public.rrt_locations (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.rrt_teams (id) on delete cascade,
  incident_id uuid references public.incidents (id) on delete set null,
  lat         double precision not null,
  lng         double precision not null,
  speed_kmh   numeric(6,2),
  heading     numeric(5,1),
  accuracy_m  numeric(8,2),
  recorded_at timestamptz not null default now(),                 -- device clock
  received_at timestamptz not null default now(),                 -- server clock
  constraint rrt_locations_lat_chk check (lat between -90 and 90),
  constraint rrt_locations_lng_chk check (lng between -180 and 180)
);

-- ---------------------------------------------------------------------
-- incident_answers : submitted answers to the resolution form
-- ---------------------------------------------------------------------
create table if not exists public.incident_answers (
  id             uuid primary key default gen_random_uuid(),
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  question_id    uuid references public.custom_questions (id) on delete set null,
  question_label text not null,                                   -- snapshot, so later template edits never rewrite history
  question_type  public.question_type not null,
  value          jsonb not null,
  answered_by    uuid references public.users (id) on delete set null,
  answered_at    timestamptz not null default now(),
  constraint incident_answers_incident_question_uq unique (incident_id, question_id)
);

-- ---------------------------------------------------------------------
-- incident_photos : photo and file metadata (files live in Storage)
-- ---------------------------------------------------------------------
create table if not exists public.incident_photos (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  question_id     uuid references public.custom_questions (id) on delete set null,
  kind            text not null default 'PHOTO',
  storage_path    text not null unique,                           -- {incident_number}/{uuid}.jpg
  thumb_path      text,
  file_name       text,
  mime_type       text not null,
  original_format text,                                           -- e.g. HEIC when converted on the phone
  size_bytes      bigint,
  lat             double precision,
  lng             double precision,
  uploaded_by     uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint incident_photos_kind_chk check (kind in ('PHOTO', 'FILE'))
);

-- ---------------------------------------------------------------------
-- notifications : one row per alert per user (in-app + push)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  team_id       uuid references public.rrt_teams (id) on delete cascade,
  type          public.notification_type not null,
  incident_id   uuid references public.incidents (id) on delete cascade,
  assignment_id uuid references public.incident_assignments (id) on delete cascade,
  title         text not null,
  body          text,
  payload       jsonb not null default '{}'::jsonb,
  read_at       timestamptz,
  push_sent_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- audit_logs : who changed what (written only by triggers)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                                               -- no foreign key: logs must survive user deletion
  actor_email text,
  action      text not null,                                      -- INSERT / UPDATE / DELETE
  entity      text not null,                                      -- table name
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- settings : tunable rules (key / jsonb value)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.rrt_teams            is 'Rapid Response Teams with live GPS state. Status is changed only by database functions.';
comment on table public.incidents            is 'One row per alarm. Status is changed only by database functions.';
comment on table public.incident_assignments is 'Every offer made to a team: the full escalation chain of an incident.';
comment on table public.rrt_locations        is 'GPS history. Dashboards read live position from rrt_teams, not from here.';

-- <<<<<<<<<< END 0002_tables.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0003_indexes_and_constraints.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0003_indexes_and_constraints.sql
-- PERS Telecom Security - Phase 1 / Step 3 of 10: indexes
-- Safe to run more than once (idempotent).
-- =====================================================================

-- ---- users ----------------------------------------------------------
create index if not exists idx_users_role_id     on public.users (role_id);
create index if not exists idx_users_rrt_team_id on public.users (rrt_team_id) where rrt_team_id is not null;
create unique index if not exists uq_users_email on public.users (lower(email)) where email is not null;

-- ---- rrt_teams ------------------------------------------------------
create index if not exists idx_rrt_teams_status       on public.rrt_teams (status);
create index if not exists idx_rrt_teams_last_seen_at on public.rrt_teams (last_seen_at desc);
create index if not exists idx_rrt_teams_active       on public.rrt_teams (is_active) where is_active;
create index if not exists idx_rrt_teams_current_inc  on public.rrt_teams (current_incident_id) where current_incident_id is not null;

-- ---- towers ---------------------------------------------------------
create index if not exists idx_towers_region on public.towers (region) where deleted_at is null;
create index if not exists idx_towers_status on public.towers (status) where deleted_at is null;
-- Type-ahead search (Incident > Create Incident > Search Tower Number)
create index if not exists idx_towers_number_trgm on public.towers using gin (tower_number extensions.gin_trgm_ops);
create index if not exists idx_towers_name_trgm   on public.towers using gin (site_name extensions.gin_trgm_ops);

-- ---- incidents ------------------------------------------------------
create index if not exists idx_incidents_status_triggered on public.incidents (status, triggered_at desc);
create index if not exists idx_incidents_tower            on public.incidents (tower_id, triggered_at desc);
create index if not exists idx_incidents_team             on public.incidents (assigned_team_id) where assigned_team_id is not null;
create index if not exists idx_incidents_region_triggered on public.incidents (region, triggered_at desc);
create index if not exists idx_incidents_triggered_at     on public.incidents (triggered_at desc);
create index if not exists idx_incidents_resolved_at      on public.incidents (resolved_at desc) where resolved_at is not null;
create index if not exists idx_incidents_waiting          on public.incidents (triggered_at)
  where status = 'OPEN' and dispatch_state = 'EXHAUSTED';
-- A tower can have only ONE live incident at a time (prevents double dispatch).
create unique index if not exists uq_incidents_one_active_per_tower
  on public.incidents (tower_id) where status in ('OPEN', 'ASSIGNED', 'REACHED');

-- ---- incident_assignments --------------------------------------------
create index if not exists idx_assignments_incident_status on public.incident_assignments (incident_id, status);
create index if not exists idx_assignments_team_status     on public.incident_assignments (team_id, status);
-- The 5-second sweep reads only this tiny partial index.
create index if not exists idx_assignments_pending_expiry  on public.incident_assignments (expires_at) where status = 'PENDING';
-- Exactly one open offer per incident, and one open offer per team.
create unique index if not exists uq_assignments_one_pending_per_incident
  on public.incident_assignments (incident_id) where status = 'PENDING';
create unique index if not exists uq_assignments_one_pending_per_team
  on public.incident_assignments (team_id) where status = 'PENDING';

-- ---- rrt_locations ---------------------------------------------------
create index if not exists idx_locations_team_received     on public.rrt_locations (team_id, received_at desc);
create index if not exists idx_locations_incident_received on public.rrt_locations (incident_id, received_at) where incident_id is not null;
create index if not exists idx_locations_received_at       on public.rrt_locations (received_at);

-- ---- forms ------------------------------------------------------------
create unique index if not exists uq_custom_forms_one_default on public.custom_forms (is_default) where is_default;
create index if not exists idx_custom_questions_form on public.custom_questions (form_id, position);

-- ---- answers and photos -------------------------------------------------
create index if not exists idx_answers_incident on public.incident_answers (incident_id);
create index if not exists idx_photos_incident  on public.incident_photos (incident_id);
create index if not exists idx_photos_question  on public.incident_photos (question_id) where question_id is not null;

-- ---- notifications -------------------------------------------------------
create index if not exists idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_user        on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_incident    on public.notifications (incident_id) where incident_id is not null;

-- ---- audit_logs ----------------------------------------------------------
create index if not exists idx_audit_entity  on public.audit_logs (entity, entity_id, created_at desc);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_actor   on public.audit_logs (actor_id) where actor_id is not null;

-- <<<<<<<<<< END 0003_indexes_and_constraints.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0004_helper_functions.sql >>>>>>>>>>
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

-- <<<<<<<<<< END 0004_helper_functions.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0005_dispatch_engine.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0005_dispatch_engine.sql
-- PERS Telecom Security - Phase 1 / Step 5 of 10: dispatch engine
--
-- INTERNAL functions (schema app, run by cron / triggers):
--   app.create_offer, app.dispatch_next, app.process_expired_offers,
--   app.retry_exhausted_incidents, app.redispatch_waiting_incidents,
--   app.mark_offline_teams
-- PUBLIC functions (API / supabase.rpc, schema public):
--   trigger_incident, accept_offer, reject_offer, set_team_online,
--   post_location, update_incident_route, resolve_incident,
--   cancel_incident, reassign_incident, mark_reached, search_towers,
--   report_summary, create_demo_tower, reset_demo
--
-- Error messages start with a CODE (e.g. OFFER_EXPIRED:) so the apps
-- can show friendly text. Safe to re-run (create or replace).
-- =====================================================================

-- =====================================================================
-- INTERNAL FUNCTIONS
-- =====================================================================

-- Create one offer (a PENDING assignment) and alert the team.
create or replace function app.create_offer(
  p_incident_id uuid,
  p_team_id     uuid,
  p_distance_km double precision,
  p_manual      boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc     public.incidents%rowtype;
  v_tower   public.towers%rowtype;
  v_seq     integer;
  v_id      uuid;
  v_expires timestamptz;
  v_dist    numeric;
begin
  select * into v_inc   from public.incidents where id = p_incident_id;
  select * into v_tower from public.towers    where id = v_inc.tower_id;

  select coalesce(max(a.sequence_no), 0) + 1
    into v_seq
    from public.incident_assignments a
   where a.incident_id = p_incident_id;

  v_dist    := round(coalesce(p_distance_km, 0)::numeric, 3);
  v_expires := now() + make_interval(secs => app.setting_num('offer_timeout_seconds', 30)::double precision);

  insert into public.incident_assignments
    (incident_id, team_id, sequence_no, round_no, distance_km, status, manual, offered_at, expires_at)
  values
    (p_incident_id, p_team_id, v_seq, v_inc.dispatch_round, v_dist, 'PENDING', p_manual, now(), v_expires)
  returning id into v_id;

  update public.incidents
     set dispatch_state = 'OFFERING',
         last_dispatch_at = now()
   where id = p_incident_id;

  perform app.notify_team(
    p_team_id,
    'INCIDENT_OFFER',
    p_incident_id,
    v_id,
    'Incident Alert',
    'Tower: ' || v_tower.tower_number || E'\nDistance: ' || to_char(round(v_dist, 1), 'FM999990.0') || ' KM',
    jsonb_build_object(
      'incident_number', v_inc.incident_number,
      'tower_number',    v_tower.tower_number,
      'tower_name',      v_tower.site_name,
      'distance_km',     round(v_dist, 1),
      'expires_at',      v_expires,
      'timeout_seconds', app.setting_num('offer_timeout_seconds', 30)
    ));

  return v_id;
end
$$;

-- Offer the incident to the NEAREST eligible team (Haversine).
-- Eligible = active, AVAILABLE, fresh GPS, no live incident, no open offer,
-- and not already offered this incident in the current round.
create or replace function app.dispatch_next(p_incident_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc     public.incidents%rowtype;
  v_tower   public.towers%rowtype;
  v_team_id uuid;
  v_dist    double precision;
  v_stale   interval;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.status <> 'OPEN' then
    return 'SKIPPED';
  end if;

  if exists (select 1 from public.incident_assignments a
              where a.incident_id = v_inc.id and a.status = 'PENDING') then
    return 'PENDING_EXISTS';
  end if;

  select * into v_tower from public.towers where id = v_inc.tower_id;
  v_stale := make_interval(secs => app.setting_num('offline_after_seconds', 45)::double precision);

  select t.id, public.haversine_km(t.last_lat, t.last_lng, v_tower.lat, v_tower.lng)
    into v_team_id, v_dist
    from public.rrt_teams t
   where t.is_active
     and t.status = 'AVAILABLE'
     and t.current_incident_id is null
     and t.last_lat is not null
     and t.last_lng is not null
     and t.last_seen_at >= now() - v_stale
     and not exists (select 1 from public.incident_assignments a
                      where a.incident_id = v_inc.id
                        and a.team_id = t.id
                        and a.round_no = v_inc.dispatch_round)
     and not exists (select 1 from public.incident_assignments p
                      where p.team_id = t.id and p.status = 'PENDING')
   order by public.haversine_km(t.last_lat, t.last_lng, v_tower.lat, v_tower.lng) asc, t.code asc
   limit 1
   for update of t skip locked;

  if v_team_id is null then
    update public.incidents
       set dispatch_state = 'EXHAUSTED',
           last_dispatch_at = now()
     where id = v_inc.id;

    if v_inc.dispatch_state <> 'EXHAUSTED'
       and (v_inc.dispatch_round = 1
            or v_inc.dispatch_round >= app.setting_num('max_dispatch_rounds', 3)) then
      perform app.notify_staff(
        'INCIDENT_EXHAUSTED',
        v_inc.id,
        'No team available',
        'Incident ' || v_inc.incident_number || ' at tower ' || v_tower.tower_number
          || ' has no available team. Assign one manually.',
        jsonb_build_object('incident_number', v_inc.incident_number,
                           'tower_number', v_tower.tower_number,
                           'round', v_inc.dispatch_round));
    end if;
    return 'EXHAUSTED';
  end if;

  perform app.create_offer(v_inc.id, v_team_id, v_dist, false);
  return 'OFFERED';
end
$$;

-- Called every 5 seconds by pg_cron: expire overdue offers and escalate.
create or replace function app.process_expired_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select a.id, a.incident_id
      from public.incident_assignments a
     where a.status = 'PENDING'
       and a.expires_at <= now()
     order by a.expires_at
       for update skip locked
  loop
    update public.incident_assignments
       set status = 'EXPIRED',
           responded_at = now(),
           response_reason = 'TIMEOUT'
     where id = r.id;

    perform app.dispatch_next(r.incident_id);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Called every minute by pg_cron: start a new round for incidents that
-- found no team, up to max_dispatch_rounds.
create or replace function app.retry_exhausted_incidents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select i.id
      from public.incidents i
     where i.status = 'OPEN'
       and i.dispatch_state = 'EXHAUSTED'
       and i.dispatch_round < app.setting_num('max_dispatch_rounds', 3)
       and i.last_dispatch_at <= now() - make_interval(secs => app.setting_num('retry_interval_seconds', 60)::double precision)
     order by i.triggered_at
       for update skip locked
  loop
    update public.incidents
       set dispatch_round = dispatch_round + 1,
           dispatch_state = 'OFFERING'
     where id = r.id;

    perform app.dispatch_next(r.id);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Called when a team becomes AVAILABLE: waiting incidents are offered at once.
create or replace function app.redispatch_waiting_incidents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select i.id
      from public.incidents i
     where i.status = 'OPEN'
       and i.dispatch_state = 'EXHAUSTED'
     order by i.triggered_at
       for update skip locked
  loop
    perform app.dispatch_next(r.id);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Called every 15 seconds by pg_cron: stale AVAILABLE teams become OFFLINE;
-- the operator is alerted once when a team on an incident loses GPS.
create or replace function app.mark_offline_teams()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale interval := make_interval(secs => app.setting_num('offline_after_seconds', 45)::double precision);
  n integer;
  r record;
begin
  update public.rrt_teams t
     set status = 'OFFLINE'
   where t.status = 'AVAILABLE'
     and (t.last_seen_at is null or t.last_seen_at < now() - v_stale);
  get diagnostics n = row_count;

  for r in
    select t.id, t.code, t.name, t.current_incident_id
      from public.rrt_teams t
     where t.current_incident_id is not null
       and not t.stale_alerted
       and (t.last_seen_at is null or t.last_seen_at < now() - v_stale)
       for update skip locked
  loop
    update public.rrt_teams set stale_alerted = true where id = r.id;
    perform app.notify_staff(
      'TEAM_OFFLINE',
      r.current_incident_id,
      'Team lost GPS signal',
      r.code || ' ' || r.name || ' has stopped sending GPS while on an incident.',
      jsonb_build_object('team_code', r.code, 'team_id', r.id));
  end loop;

  return n;
end
$$;

-- =====================================================================
-- PUBLIC FUNCTIONS (called from the apps with supabase.rpc)
-- =====================================================================

-- ---------------------------------------------------------------------
-- trigger_incident : operator triggers an incident for a tower
-- ---------------------------------------------------------------------
create or replace function public.trigger_incident(
  p_tower_id uuid,
  p_source   public.incident_source default 'MAP_MENU',
  p_form_id  uuid default null,
  p_notes    text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tower  public.towers%rowtype;
  v_id     uuid;
  v_form   uuid;
  v_result text;
  v_out    jsonb;
begin
  if not (app.is_staff() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only control room staff can trigger incidents' using errcode = '42501';
  end if;

  select * into v_tower from public.towers where id = p_tower_id and deleted_at is null;
  if not found then
    raise exception 'TOWER_NOT_FOUND: that tower does not exist';
  end if;
  if v_tower.status = 'INACTIVE' then
    raise exception 'TOWER_INACTIVE: tower % is inactive', v_tower.tower_number;
  end if;
  if exists (select 1 from public.incidents i
              where i.tower_id = p_tower_id and i.status in ('OPEN', 'ASSIGNED', 'REACHED')) then
    raise exception 'TOWER_HAS_ACTIVE_INCIDENT: tower % already has an active incident', v_tower.tower_number;
  end if;

  v_form := coalesce(p_form_id,
                     (select f.id from public.custom_forms f where f.is_default and f.is_active limit 1));

  begin
    insert into public.incidents (tower_id, source, region, triggered_by, form_id, notes)
    values (p_tower_id, p_source, v_tower.region, (select auth.uid()), v_form, p_notes)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'TOWER_HAS_ACTIVE_INCIDENT: tower % already has an active incident', v_tower.tower_number;
  end;

  v_result := app.dispatch_next(v_id);

  select to_jsonb(i) || jsonb_build_object(
           'tower_number', v_tower.tower_number,
           'tower_name',   v_tower.site_name,
           'dispatch_result', v_result)
    into v_out
    from public.incidents i
   where i.id = v_id;

  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- accept_offer : team presses ACCEPT
-- ---------------------------------------------------------------------
create or replace function public.accept_offer(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a     public.incident_assignments%rowtype;
  v_i     public.incidents%rowtype;
  v_tower public.towers%rowtype;
  v_team  public.rrt_teams%rowtype;
  v_dist  double precision;
  v_eta   integer;
begin
  select * into v_a from public.incident_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'OFFER_NOT_FOUND: this offer does not exist';
  end if;
  if not app.can_act_for_team(v_a.team_id) then
    raise exception 'PERMISSION_DENIED: this offer belongs to another team' using errcode = '42501';
  end if;
  if v_a.status <> 'PENDING' then
    raise exception 'OFFER_NOT_PENDING: this offer is no longer open (status %)', v_a.status;
  end if;
  if v_a.expires_at <= now() then
    raise exception 'OFFER_EXPIRED: the 30 second window has passed';
  end if;

  select * into v_i from public.incidents where id = v_a.incident_id for update;
  if v_i.status <> 'OPEN' then
    raise exception 'INCIDENT_NOT_OPEN: the incident is already %', v_i.status;
  end if;

  select * into v_team from public.rrt_teams where id = v_a.team_id for update;
  if not v_team.is_active then
    raise exception 'TEAM_INACTIVE: this team is deactivated';
  end if;
  if v_team.current_incident_id is not null then
    raise exception 'TEAM_BUSY: this team is already on another incident';
  end if;

  select * into v_tower from public.towers where id = v_i.tower_id;

  if v_team.last_lat is not null and v_team.last_lng is not null then
    v_dist := public.haversine_km(v_team.last_lat, v_team.last_lng, v_tower.lat, v_tower.lng);
    v_eta  := round(v_dist / greatest(app.setting_num('default_speed_kmh', 40), 1) * 3600)::integer;
  end if;

  update public.incident_assignments
     set status = 'ACCEPTED', responded_at = now()
   where id = v_a.id;

  update public.incidents
     set status = 'ASSIGNED',
         assigned_team_id = v_a.team_id,
         accepted_at = now(),
         dispatch_state = 'DONE',
         eta_seconds = v_eta,
         distance_remaining_m = case when v_dist is null then null else round(v_dist * 1000)::integer end
   where id = v_i.id;

  update public.rrt_teams
     set status = 'ASSIGNED',
         current_incident_id = v_i.id,
         stale_alerted = false
   where id = v_a.team_id;

  return jsonb_build_object(
    'incident_id',     v_i.id,
    'incident_number', v_i.incident_number,
    'status',          'ASSIGNED',
    'tower_number',    v_tower.tower_number,
    'tower_name',      v_tower.site_name,
    'tower_lat',       v_tower.lat,
    'tower_lng',       v_tower.lng,
    'eta_seconds',     v_eta,
    'navigate_url',    'https://www.google.com/maps/dir/?api=1&destination='
                         || v_tower.lat::text || ',' || v_tower.lng::text || '&travelmode=driving'
  );
end
$$;

-- ---------------------------------------------------------------------
-- reject_offer : team presses REJECT; offer moves to the next nearest team
-- ---------------------------------------------------------------------
create or replace function public.reject_offer(p_assignment_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a    public.incident_assignments%rowtype;
  v_next text;
begin
  select * into v_a from public.incident_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'OFFER_NOT_FOUND: this offer does not exist';
  end if;
  if not app.can_act_for_team(v_a.team_id) then
    raise exception 'PERMISSION_DENIED: this offer belongs to another team' using errcode = '42501';
  end if;
  if v_a.status <> 'PENDING' then
    raise exception 'OFFER_NOT_PENDING: this offer is no longer open (status %)', v_a.status;
  end if;

  update public.incident_assignments
     set status = 'REJECTED',
         responded_at = now(),
         response_reason = coalesce(nullif(trim(p_reason), ''), 'REJECTED')
   where id = v_a.id;

  v_next := app.dispatch_next(v_a.incident_id);

  return jsonb_build_object('rejected', true, 'next', v_next);
end
$$;

-- ---------------------------------------------------------------------
-- set_team_online : the team's Go Online / Go Offline switch
-- ---------------------------------------------------------------------
create or replace function public.set_team_online(p_online boolean, p_team_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team   uuid;
  v_status public.team_status;
  v_stale  interval := make_interval(secs => app.setting_num('offline_after_seconds', 45)::double precision);
begin
  v_team := case when app.user_role() = 'RRT_MEMBER' then app.team_id() else p_team_id end;
  if v_team is null or not app.can_act_for_team(v_team) then
    raise exception 'PERMISSION_DENIED: you cannot change this team' using errcode = '42501';
  end if;

  update public.rrt_teams t
     set is_online_enabled = p_online,
         status = case
                    when t.current_incident_id is not null then t.status
                    when p_online and t.is_active and t.last_seen_at is not null
                         and t.last_seen_at >= now() - v_stale then 'AVAILABLE'::public.team_status
                    when p_online then t.status
                    else 'OFFLINE'::public.team_status
                  end
   where t.id = v_team
  returning t.status into v_status;

  return jsonb_build_object('team_id', v_team, 'online_enabled', p_online, 'status', v_status);
end
$$;

-- ---------------------------------------------------------------------
-- post_location : the phone sends GPS every 10 seconds
-- (a trigger stores history, updates the team, and detects arrival)
-- ---------------------------------------------------------------------
create or replace function public.post_location(
  p_lat        double precision,
  p_lng        double precision,
  p_speed_kmh  numeric default null,
  p_heading    numeric default null,
  p_accuracy_m numeric default null,
  p_team_id    uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_out  jsonb;
begin
  v_team := case when app.user_role() = 'RRT_MEMBER' then app.team_id() else p_team_id end;
  if v_team is null or not app.can_act_for_team(v_team) then
    raise exception 'PERMISSION_DENIED: you cannot send location for this team' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION: latitude or longitude is out of range';
  end if;
  if not exists (select 1 from public.rrt_teams t where t.id = v_team and t.is_active) then
    raise exception 'TEAM_INACTIVE: this team is deactivated';
  end if;

  insert into public.rrt_locations (team_id, incident_id, lat, lng, speed_kmh, heading, accuracy_m)
  select t.id, t.current_incident_id, p_lat, p_lng,
         case when p_speed_kmh is null then null else least(greatest(p_speed_kmh, 0), 999.99) end,
         case when p_heading   is null then null else mod(p_heading, 360) end,
         case when p_accuracy_m is null then null else least(greatest(p_accuracy_m, 0), 999999.99) end
    from public.rrt_teams t
   where t.id = v_team;

  select jsonb_build_object(
           'team_status',          t.status,
           'incident_id',          t.current_incident_id,
           'incident_status',      i.status,
           'distance_remaining_m', i.distance_remaining_m,
           'eta_seconds',          i.eta_seconds)
    into v_out
    from public.rrt_teams t
    left join public.incidents i on i.id = t.current_incident_id
   where t.id = v_team;

  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- update_incident_route : phone stores Mapbox Directions route + ETA
-- ---------------------------------------------------------------------
create or replace function public.update_incident_route(
  p_incident_id uuid,
  p_eta_seconds integer,
  p_distance_m  integer,
  p_geojson     jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.incidents%rowtype;
begin
  select * into v_i from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND: that incident does not exist';
  end if;
  if v_i.assigned_team_id is null or not app.can_act_for_team(v_i.assigned_team_id) then
    raise exception 'PERMISSION_DENIED: this incident belongs to another team' using errcode = '42501';
  end if;
  if v_i.status <> 'ASSIGNED' then
    return;   -- nothing to update once the team has arrived or the incident ended
  end if;
  if p_geojson is not null and (jsonb_typeof(p_geojson) <> 'object' or pg_column_size(p_geojson) > 262144) then
    raise exception 'INVALID_ROUTE: route must be a GeoJSON object under 256 KB';
  end if;

  update public.incidents
     set eta_seconds = greatest(p_eta_seconds, 0),
         route_distance_m = greatest(p_distance_m, 0),
         route_geojson = coalesce(p_geojson, route_geojson),
         eta_updated_at = now()
   where id = p_incident_id;
end
$$;

-- ---------------------------------------------------------------------
-- resolve_incident : team submits the resolution form
-- p_answers = [{"question_id": "<uuid>", "value": <json>}, ...]
-- Photos / files are uploaded first and linked through incident_photos.
-- ---------------------------------------------------------------------
create or replace function public.resolve_incident(
  p_incident_id uuid,
  p_answers     jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i     public.incidents%rowtype;
  v_form  uuid;
  q       public.custom_questions%rowtype;
  v_val   jsonb;
  v_has   boolean;
  v_num   numeric;
  v_files integer;
  v_need  integer;
  v_uid   uuid := (select auth.uid());
begin
  if p_answers is null then
    p_answers := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'INVALID_ANSWERS: answers must be a JSON array';
  end if;

  select * into v_i from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND: that incident does not exist';
  end if;
  if v_i.assigned_team_id is null or not app.can_act_for_team(v_i.assigned_team_id) then
    raise exception 'PERMISSION_DENIED: this incident belongs to another team' using errcode = '42501';
  end if;
  if v_i.status not in ('ASSIGNED', 'REACHED') then
    raise exception 'INCIDENT_NOT_ACTIVE: the incident is %', v_i.status;
  end if;

  v_form := coalesce(v_i.form_id,
                     (select f.id from public.custom_forms f where f.is_default and f.is_active limit 1));

  for q in
    select * from public.custom_questions cq
     where cq.form_id = v_form and cq.is_active
     order by cq.position
  loop
    -- Photo and file questions are satisfied by uploaded files.
    if q.type in ('PHOTO', 'FILE') then
      select count(*) into v_files
        from public.incident_photos p
       where p.incident_id = v_i.id and p.question_id = q.id;
      v_need := greatest(q.min_files, case when q.is_required then 1 else 0 end);
      if v_files < v_need then
        raise exception 'REQUIRED_QUESTION: "%" needs at least % file(s)', q.label, v_need;
      end if;
      continue;
    end if;

    select a -> 'value' into v_val
      from jsonb_array_elements(p_answers) a
     where a ->> 'question_id' = q.id::text
     limit 1;

    v_has := v_val is not null
             and v_val <> 'null'::jsonb
             and v_val <> '""'::jsonb
             and v_val <> '[]'::jsonb;

    if not v_has then
      if q.is_required then
        raise exception 'REQUIRED_QUESTION: "%" is required', q.label;
      end if;
      continue;
    end if;

    case q.type
      when 'YES_NO' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'INVALID_ANSWER: "%" must be Yes or No', q.label;
        end if;
      when 'RATING' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'INVALID_ANSWER: "%" must be a number', q.label;
        end if;
        v_num := (v_val #>> '{}')::numeric;
        if v_num <> trunc(v_num) or v_num < q.scale_min or v_num > q.scale_max then
          raise exception 'INVALID_ANSWER: "%" must be a whole number from % to %', q.label, q.scale_min, q.scale_max;
        end if;
      when 'TEXT' then
        if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 4000 then
          raise exception 'INVALID_ANSWER: "%" must be text of at most 4000 characters', q.label;
        end if;
      when 'DROPDOWN' then
        if jsonb_typeof(v_val) <> 'string' or not (q.options ? (v_val #>> '{}')) then
          raise exception 'INVALID_ANSWER: "%" must be one of the listed options', q.label;
        end if;
      when 'MULTI_SELECT' then
        if jsonb_typeof(v_val) <> 'array'
           or exists (select 1 from jsonb_array_elements(v_val) e
                       where jsonb_typeof(e) <> 'string' or not (q.options ? (e #>> '{}'))) then
          raise exception 'INVALID_ANSWER: "%" must only contain the listed options', q.label;
        end if;
      else
        null;
    end case;

    insert into public.incident_answers
      (incident_id, question_id, question_label, question_type, value, answered_by)
    values
      (v_i.id, q.id, q.label, q.type, v_val, v_uid)
    on conflict (incident_id, question_id) do update
      set value = excluded.value,
          question_label = excluded.question_label,
          question_type = excluded.question_type,
          answered_by = excluded.answered_by,
          answered_at = now();
  end loop;

  -- If GPS never detected arrival, record the arrival now (flagged manual).
  if v_i.status = 'ASSIGNED' then
    update public.incidents
       set status = 'REACHED', reached_at = now(), reached_manually = true, eta_seconds = 0
     where id = v_i.id;
  end if;

  update public.incidents
     set status = 'RESOLVED', resolved_at = now()
   where id = v_i.id;

  perform app.release_team(v_i.assigned_team_id);

  perform app.notify_staff(
    'INCIDENT_RESOLVED', v_i.id, 'Incident resolved',
    'Incident ' || v_i.incident_number || ' was resolved.',
    jsonb_build_object('incident_number', v_i.incident_number));

  return (select jsonb_build_object(
                   'incident_id', i.id,
                   'incident_number', i.incident_number,
                   'status', i.status,
                   'resolved_at', i.resolved_at,
                   'resolution_seconds', i.resolution_seconds)
            from public.incidents i where i.id = v_i.id);
end
$$;

-- ---------------------------------------------------------------------
-- cancel_incident : operator cancels an incident
-- ---------------------------------------------------------------------
create or replace function public.cancel_incident(p_incident_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i      public.incidents%rowtype;
  v_notify record;
begin
  if not (app.is_staff() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only control room staff can cancel incidents' using errcode = '42501';
  end if;

  perform 1 from public.incident_assignments a
   where a.incident_id = p_incident_id and a.status = 'PENDING'
     for update;

  select * into v_i from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND: that incident does not exist';
  end if;
  if v_i.status not in ('OPEN', 'ASSIGNED', 'REACHED') then
    raise exception 'INCIDENT_NOT_ACTIVE: the incident is already %', v_i.status;
  end if;

  -- Close pop-ups on phones that still hold an open offer.
  for v_notify in
    select a.id, a.team_id
      from public.incident_assignments a
     where a.incident_id = v_i.id and a.status = 'PENDING'
  loop
    perform app.notify_team(v_notify.team_id, 'INCIDENT_CANCELLED', v_i.id, v_notify.id,
                            'Incident cancelled',
                            'Incident ' || v_i.incident_number || ' was cancelled by the control room.',
                            jsonb_build_object('incident_number', v_i.incident_number));
  end loop;

  update public.incident_assignments
     set status = 'CANCELLED', responded_at = now(), response_reason = 'INCIDENT_CANCELLED'
   where incident_id = v_i.id and status = 'PENDING';

  update public.incidents
     set status = 'CANCELLED',
         dispatch_state = 'DONE',
         cancelled_at = now(),
         cancel_reason = nullif(trim(p_reason), '')
   where id = v_i.id;

  if v_i.assigned_team_id is not null then
    perform app.release_team(v_i.assigned_team_id);
    perform app.notify_team(v_i.assigned_team_id, 'INCIDENT_CANCELLED', v_i.id, null,
                            'Incident cancelled',
                            'Incident ' || v_i.incident_number || ' was cancelled by the control room.',
                            jsonb_build_object('incident_number', v_i.incident_number));
  end if;

  return jsonb_build_object('incident_id', v_i.id, 'incident_number', v_i.incident_number, 'status', 'CANCELLED');
end
$$;

-- ---------------------------------------------------------------------
-- reassign_incident : operator restarts dispatch, optionally to a chosen team
--   p_team_id null  -> dispatch to the nearest available team in a new round
--   p_team_id given -> targeted offer (the team still accepts or rejects)
-- ---------------------------------------------------------------------
create or replace function public.reassign_incident(p_incident_id uuid, p_team_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i     public.incidents%rowtype;
  v_tower public.towers%rowtype;
  v_team  public.rrt_teams%rowtype;
  v_round smallint;
  v_dist  double precision;
  v_res   text;
begin
  if not (app.is_staff() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only control room staff can reassign incidents' using errcode = '42501';
  end if;

  perform 1 from public.incident_assignments a
   where a.incident_id = p_incident_id and a.status in ('PENDING', 'ACCEPTED')
     for update;

  select * into v_i from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND: that incident does not exist';
  end if;
  if v_i.status not in ('OPEN', 'ASSIGNED') then
    raise exception 'INCIDENT_NOT_ACTIVE: only OPEN or ASSIGNED incidents can be reassigned (this one is %)', v_i.status;
  end if;

  select * into v_tower from public.towers where id = v_i.tower_id;
  v_round := v_i.dispatch_round + 1;

  update public.incident_assignments
     set status = 'CANCELLED', responded_at = now(), response_reason = 'REASSIGNED'
   where incident_id = v_i.id and status = 'PENDING';

  if v_i.status = 'ASSIGNED' then
    -- round_no moves to the new round so the previous team is not re-offered automatically
    update public.incident_assignments
       set status = 'CANCELLED', responded_at = now(), response_reason = 'REASSIGNED', round_no = v_round
     where incident_id = v_i.id and status = 'ACCEPTED';

    perform app.release_team(v_i.assigned_team_id);
    perform app.notify_team(v_i.assigned_team_id, 'INCIDENT_CANCELLED', v_i.id, null,
                            'Incident reassigned',
                            'Incident ' || v_i.incident_number || ' was reassigned by the control room.',
                            jsonb_build_object('incident_number', v_i.incident_number));

    update public.incidents
       set status = 'OPEN',
           assigned_team_id = null,
           accepted_at = null,
           eta_seconds = null,
           eta_updated_at = null,
           distance_remaining_m = null,
           route_distance_m = null,
           route_geojson = null
     where id = v_i.id;
  end if;

  update public.incidents
     set dispatch_round = v_round,
         dispatch_state = 'OFFERING'
   where id = v_i.id;

  if p_team_id is null then
    v_res := app.dispatch_next(v_i.id);
  else
    select * into v_team from public.rrt_teams where id = p_team_id for update;
    if not found or not v_team.is_active then
      raise exception 'TEAM_NOT_FOUND: that team does not exist or is deactivated';
    end if;
    if v_team.current_incident_id is not null
       or exists (select 1 from public.incident_assignments a where a.team_id = p_team_id and a.status = 'PENDING') then
      raise exception 'TEAM_BUSY: % is already on another incident or has an open offer', v_team.code;
    end if;
    v_dist := case when v_team.last_lat is null then 0
                   else public.haversine_km(v_team.last_lat, v_team.last_lng, v_tower.lat, v_tower.lng) end;
    perform app.create_offer(v_i.id, p_team_id, v_dist, true);
    v_res := 'OFFERED_MANUALLY';
  end if;

  return jsonb_build_object('incident_id', v_i.id, 'incident_number', v_i.incident_number,
                            'round', v_round, 'dispatch_result', v_res);
end
$$;

-- ---------------------------------------------------------------------
-- mark_reached : operator records arrival by hand (e.g. poor GPS at site)
-- ---------------------------------------------------------------------
create or replace function public.mark_reached(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.incidents%rowtype;
begin
  if not (app.is_staff() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only control room staff can mark arrival' using errcode = '42501';
  end if;

  select * into v_i from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND: that incident does not exist';
  end if;
  if v_i.status <> 'ASSIGNED' then
    raise exception 'INCIDENT_NOT_ASSIGNED: only an ASSIGNED incident can be marked reached (this one is %)', v_i.status;
  end if;

  update public.incidents
     set status = 'REACHED', reached_at = now(), reached_manually = true,
         eta_seconds = 0, distance_remaining_m = 0
   where id = v_i.id;

  update public.rrt_teams set status = 'REACHED' where id = v_i.assigned_team_id;

  perform app.notify_staff('INCIDENT_REACHED', v_i.id, 'RRT reached incident location',
                           'Incident ' || v_i.incident_number || ': arrival recorded by the control room.',
                           jsonb_build_object('incident_number', v_i.incident_number, 'manual', true));

  return jsonb_build_object('incident_id', v_i.id, 'status', 'REACHED');
end
$$;

-- ---------------------------------------------------------------------
-- search_towers : type-ahead for Incident > Create Incident
-- (SECURITY INVOKER: row level security still applies)
-- ---------------------------------------------------------------------
create or replace function public.search_towers(p_query text, p_limit integer default 10)
returns table (
  id           uuid,
  tower_number text,
  site_name    text,
  region       text,
  lat          double precision,
  lng          double precision,
  status       public.tower_status
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.tower_number, t.site_name, t.region, t.lat, t.lng, t.status
    from public.towers t
   where t.deleted_at is null
     and (t.tower_number ilike '%' || trim(p_query) || '%'
          or t.site_name ilike '%' || trim(p_query) || '%')
   order by (upper(t.tower_number) = upper(trim(p_query))) desc,
            (t.tower_number ilike trim(p_query) || '%') desc,
            t.tower_number
   limit least(greatest(p_limit, 1), 50)
$$;

-- ---------------------------------------------------------------------
-- report_summary : numbers for the report cover page
-- (SECURITY INVOKER: row level security still applies)
-- ---------------------------------------------------------------------
create or replace function public.report_summary(
  p_from   timestamptz,
  p_to     timestamptz,
  p_region text default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with i as (
    select *
      from public.incidents x
     where x.triggered_at >= p_from
       and x.triggered_at <  p_to
       and (p_region is null or x.region = p_region)
  )
  select jsonb_build_object(
    'from',                p_from,
    'to',                  p_to,
    'region',              p_region,
    'total',               (select count(*) from i),
    'resolved',            (select count(*) from i where status = 'RESOLVED'),
    'cancelled',           (select count(*) from i where status = 'CANCELLED'),
    'in_progress',         (select count(*) from i where status in ('OPEN', 'ASSIGNED', 'REACHED')),
    'avg_accept_seconds',     (select round(avg(accept_seconds))     from i),
    'avg_travel_seconds',     (select round(avg(travel_seconds))     from i),
    'avg_response_seconds',   (select round(avg(response_seconds))   from i),
    'avg_onsite_seconds',     (select round(avg(onsite_seconds))     from i),
    'avg_resolution_seconds', (select round(avg(resolution_seconds)) from i),
    'first_offer_accept_pct', (
        select round(100.0 * count(*) filter (where a.sequence_no = 1) / nullif(count(*), 0), 1)
          from public.incident_assignments a
          join i on i.id = a.incident_id
         where a.status = 'ACCEPTED'),
    'by_region', (
        select coalesce(jsonb_agg(jsonb_build_object('region', r.region, 'incidents', r.n) order by r.n desc, r.region), '[]'::jsonb)
          from (select region, count(*) as n from i group by region) r)
  )
$$;

-- ---------------------------------------------------------------------
-- create_demo_tower : demo helper. Creates a tower p_offset_m metres
-- north of the given point (default 30 m = inside the 50 m arrival radius).
-- ---------------------------------------------------------------------
create or replace function public.create_demo_tower(
  p_lat      double precision,
  p_lng      double precision,
  p_offset_m integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
  v_row    public.towers%rowtype;
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only administrators can create demo towers' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION: latitude or longitude is out of range';
  end if;

  v_number := 'DEMO-' || to_char(now() at time zone app.report_tz(), 'HH24MISS');
  if exists (select 1 from public.towers t where t.tower_number = v_number) then
    v_number := v_number || '-' || substr(gen_random_uuid()::text, 1, 4);
  end if;

  insert into public.towers (tower_number, site_name, lat, lng, region, status, address, created_by)
  values (v_number, 'Demo Tower ' || v_number,
          p_lat + (greatest(p_offset_m, 0)::double precision / 111320.0),
          p_lng, 'Demo', 'ACTIVE', 'Created by Demo Controller', (select auth.uid()))
  returning * into v_row;

  return to_jsonb(v_row);
end
$$;

-- ---------------------------------------------------------------------
-- reset_demo : put the demo back to its seeded state
--   removes every incident that is not seeded history, removes demo
--   towers, parks simulated teams at their base and frees all teams.
-- ---------------------------------------------------------------------
create or replace function public.reset_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc integer;
  v_twr integer;
  r record;
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only administrators can reset the demo' using errcode = '42501';
  end if;

  update public.rrt_teams set current_incident_id = null where current_incident_id is not null;

  delete from public.incidents where not is_demo_seed;
  get diagnostics v_inc = row_count;

  delete from public.towers t
   where t.region = 'Demo'
     and not exists (select 1 from public.incidents i where i.tower_id = t.id);
  get diagnostics v_twr = row_count;

  delete from public.rrt_locations
   where team_id in (select id from public.rrt_teams where is_simulated);

  update public.rrt_teams
     set last_lat = home_lat,
         last_lng = home_lng,
         last_speed_kmh = 0,
         last_heading = null,
         last_seen_at = now(),
         stale_alerted = false,
         is_online_enabled = true,
         status = 'AVAILABLE'
   where is_simulated and is_active and home_lat is not null;

  for r in select id from public.rrt_teams where not is_simulated loop
    perform app.release_team(r.id);
  end loop;

  return jsonb_build_object('incidents_removed', v_inc, 'demo_towers_removed', v_twr);
end
$$;

-- =====================================================================
-- PRIVILEGES: only signed-in users and the service role may call the
-- public functions; anonymous visitors may not.
-- =====================================================================
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'trigger_incident', 'accept_offer', 'reject_offer', 'set_team_online',
         'post_location', 'update_incident_route', 'resolve_incident',
         'cancel_incident', 'reassign_incident', 'mark_reached',
         'search_towers', 'report_summary', 'create_demo_tower', 'reset_demo'])
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

-- <<<<<<<<<< END 0005_dispatch_engine.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0006_triggers.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0006_triggers.sql
-- PERS Telecom Security - Phase 1 / Step 6 of 10: triggers
--
--   * updated_at maintenance
--   * incident numbering and status-transition guard
--   * GPS pipeline: store ping, update team, ARRIVAL DETECTION (< 50 m)
--   * waiting incidents are offered when a team becomes available
--   * user privilege guard
--   * audit log
--   * push notification hook (pg_net -> Edge Function)
--   * data hygiene (tower numbers, single default form, settings ranges)
-- Safe to run more than once (drop trigger if exists + create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Incident number, region copy
-- ---------------------------------------------------------------------
create or replace function app.incidents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.incident_number is null or new.incident_number = '' then
    new.incident_number := app.next_incident_number();
  end if;
  if new.region is null then
    select t.region into new.region from public.towers t where t.id = new.tower_id;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- Status transition guard: status can only move forward along the
-- lifecycle (plus ASSIGNED -> OPEN for reassignment).
-- ---------------------------------------------------------------------
create or replace function app.incidents_status_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if (old.status::text, new.status::text) not in (
       ('OPEN', 'ASSIGNED'),
       ('OPEN', 'CANCELLED'),
       ('ASSIGNED', 'REACHED'),
       ('ASSIGNED', 'OPEN'),
       ('ASSIGNED', 'CANCELLED'),
       ('REACHED', 'RESOLVED'),
       ('REACHED', 'CANCELLED')) then
    raise exception 'ILLEGAL_STATUS_CHANGE: an incident cannot move from % to %', old.status, new.status;
  end if;

  if new.status = 'CANCELLED' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- GPS pipeline. Runs after every row in rrt_locations:
--   1. copies the newest position onto the team (dashboards subscribe to this row)
--   2. brings an enabled OFFLINE team back to AVAILABLE
--   3. while the team is ASSIGNED: updates distance and ETA and detects ARRIVAL
-- ---------------------------------------------------------------------
create or replace function app.on_location_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team    public.rrt_teams%rowtype;
  v_inc     public.incidents%rowtype;
  v_tower   public.towers%rowtype;
  v_dist_m  double precision;
  v_radius  numeric := app.setting_num('arrival_radius_m', 50);
  v_max_acc numeric := app.setting_num('arrival_max_accuracy_m', 100);
  v_fresh   interval := make_interval(secs => app.setting_num('eta_fresh_seconds', 90)::double precision);
  v_eta     integer;
begin
  update public.rrt_teams t
     set last_lat        = new.lat,
         last_lng        = new.lng,
         last_speed_kmh  = new.speed_kmh,
         last_heading    = new.heading,
         last_accuracy_m = new.accuracy_m,
         last_seen_at    = now(),
         stale_alerted   = false,
         status = case
                    when t.status = 'OFFLINE'
                     and t.is_online_enabled
                     and t.is_active
                     and t.current_incident_id is null
                    then 'AVAILABLE'::public.team_status
                    else t.status
                  end
   where t.id = new.team_id
  returning * into v_team;

  if not found or v_team.current_incident_id is null then
    return new;
  end if;

  select * into v_inc
    from public.incidents
   where id = v_team.current_incident_id
     for update;

  if not found or v_inc.status <> 'ASSIGNED' then
    return new;
  end if;

  select * into v_tower from public.towers where id = v_inc.tower_id;
  v_dist_m := public.haversine_km(new.lat, new.lng, v_tower.lat, v_tower.lng) * 1000.0;

  if v_dist_m <= v_radius and coalesce(new.accuracy_m, 0) <= v_max_acc then
    -- ARRIVED
    update public.incidents
       set status = 'REACHED',
           reached_at = now(),
           reached_manually = false,
           distance_remaining_m = round(v_dist_m)::integer,
           eta_seconds = 0
     where id = v_inc.id;

    update public.rrt_teams set status = 'REACHED' where id = v_team.id;

    perform app.notify_staff(
      'INCIDENT_REACHED', v_inc.id, 'RRT reached incident location',
      v_team.code || ' reached tower ' || v_tower.tower_number || ' (incident ' || v_inc.incident_number || ').',
      jsonb_build_object('incident_number', v_inc.incident_number,
                         'tower_number', v_tower.tower_number,
                         'team_code', v_team.code,
                         'team_name', v_team.name,
                         'distance_m', round(v_dist_m)));
  else
    -- Still travelling: refresh distance; use a speed-based ETA when the
    -- Mapbox route ETA has not been refreshed recently.
    if v_inc.eta_updated_at is null or v_inc.eta_updated_at < now() - v_fresh then
      v_eta := round((v_dist_m / 1000.0) / greatest(coalesce(new.speed_kmh, 0), 25)::double precision * 3600.0)::integer;
    else
      v_eta := v_inc.eta_seconds;
    end if;

    update public.incidents
       set distance_remaining_m = round(v_dist_m)::integer,
           eta_seconds = v_eta
     where id = v_inc.id;
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------
-- When a team becomes AVAILABLE, offer any waiting incident immediately.
-- ---------------------------------------------------------------------
create or replace function app.teams_became_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.redispatch_waiting_incidents();
  return null;
end
$$;

-- ---------------------------------------------------------------------
-- users: privilege guard
--   * non-admins cannot change role, team, active flag or e-mail
--   * only a Super Admin can create or promote Super Admins / Administrators
--   * an RRT member must belong to a team; others never have a team
-- When there is no signed-in user (secret key, SQL editor, seed scripts)
-- the privilege checks are skipped.
-- ---------------------------------------------------------------------
create or replace function app.users_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code   public.role_code;
  v_caller uuid := (select auth.uid());
begin
  new.email := lower(new.email);

  select r.code into v_code from public.roles r where r.id = new.role_id;

  if v_caller is not null then
    if tg_op = 'UPDATE' and not app.is_admin() then
      if new.role_id    is distinct from old.role_id
         or new.rrt_team_id is distinct from old.rrt_team_id
         or new.is_active   is distinct from old.is_active
         or new.email       is distinct from old.email then
        raise exception 'PERMISSION_DENIED: you cannot change role, team, status or e-mail' using errcode = '42501';
      end if;
    end if;

    if v_code in ('SUPER_ADMIN', 'ADMIN')
       and not app.is_super()
       and (tg_op = 'INSERT' or new.role_id is distinct from old.role_id) then
      raise exception 'PERMISSION_DENIED: only a Super Admin can grant this role' using errcode = '42501';
    end if;
  end if;

  if v_code = 'RRT_MEMBER' then
    if new.rrt_team_id is null then
      raise exception 'RRT_TEAM_REQUIRED: an RRT team member must be linked to a team';
    end if;
  else
    new.rrt_team_id := null;
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------
-- Audit log (written only by this trigger; skipped while seeding)
-- ---------------------------------------------------------------------
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_id     text;
begin
  if coalesce(current_setting('pers.skip_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after  := to_jsonb(new); end if;

  v_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key');

  -- Keep secrets and bulky data out of the log.
  if tg_table_name = 'users' then
    v_before := v_before - 'push_subscriptions';
    v_after  := v_after  - 'push_subscriptions';
  elsif tg_table_name = 'incidents' then
    v_before := v_before - 'route_geojson';
    v_after  := v_after  - 'route_geojson';
  end if;

  insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, before, after)
  values ((select auth.uid()),
          (select auth.jwt()) ->> 'email',
          tg_op, tg_table_name, v_id, v_before, v_after);

  return null;
end
$$;

-- ---------------------------------------------------------------------
-- Push notification hook: when a notification row is created, call the
-- send-push Edge Function through pg_net. It does nothing until the two
-- database settings app.push_function_url and app.push_function_secret
-- are configured (done in the deployment guide). It can never block or
-- fail the insert.
-- ---------------------------------------------------------------------
create or replace function app.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text := nullif(current_setting('app.push_function_url', true), '');
  v_secret text := coalesce(current_setting('app.push_function_secret', true), '');
begin
  if v_url is null then
    return null;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-pers-secret', v_secret),
      body    := jsonb_build_object('notification_id', new.id),
      timeout_milliseconds := 3000);
  exception when others then
    null;   -- never block the alert because push failed
  end;

  return null;
end
$$;

-- ---------------------------------------------------------------------
-- Data hygiene
-- ---------------------------------------------------------------------
create or replace function app.towers_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tower_number := upper(trim(new.tower_number));
  new.site_name    := trim(new.site_name);
  new.region       := trim(new.region);
  if new.tower_number = '' or new.site_name = '' or new.region = '' then
    raise exception 'INVALID_TOWER: tower number, site name and region are required';
  end if;
  return new;
end
$$;

create or replace function app.forms_single_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default then
    update public.custom_forms set is_default = false where id <> new.id and is_default;
  end if;
  return new;
end
$$;

create or replace function app.forms_bump_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form uuid := coalesce(new.form_id, old.form_id);
begin
  update public.custom_forms set version = version + 1 where id = v_form;
  return null;
end
$$;

create or replace function app.settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if jsonb_typeof(new.value) = 'number' then
    v_num := (new.value #>> '{}')::numeric;
    if (new.key = 'offer_timeout_seconds'   and v_num not between 5 and 300)
    or (new.key = 'arrival_radius_m'        and v_num not between 5 and 2000)
    or (new.key = 'offline_after_seconds'   and v_num not between 15 and 600)
    or (new.key = 'gps_interval_seconds'    and v_num not between 2 and 120)
    or (new.key = 'max_dispatch_rounds'     and v_num not between 1 and 20)
    or (new.key = 'retry_interval_seconds'  and v_num not between 10 and 3600)
    or (new.key = 'location_retention_days' and v_num not between 1 and 3650) then
      raise exception 'INVALID_SETTING: value % is outside the allowed range for %', v_num, new.key;
    end if;
  end if;
  return new;
end
$$;

-- =====================================================================
-- Attach the triggers
-- =====================================================================

-- updated_at ----------------------------------------------------------
drop trigger if exists trg_touch_users            on public.users;
create trigger trg_touch_users            before update on public.users            for each row execute function app.touch_updated_at();
drop trigger if exists trg_touch_rrt_teams        on public.rrt_teams;
create trigger trg_touch_rrt_teams        before update on public.rrt_teams        for each row execute function app.touch_updated_at();
drop trigger if exists trg_touch_towers           on public.towers;
create trigger trg_touch_towers           before update on public.towers           for each row execute function app.touch_updated_at();
drop trigger if exists trg_touch_incidents        on public.incidents;
create trigger trg_touch_incidents        before update on public.incidents        for each row execute function app.touch_updated_at();
drop trigger if exists trg_touch_custom_forms     on public.custom_forms;
create trigger trg_touch_custom_forms     before update on public.custom_forms     for each row execute function app.touch_updated_at();
drop trigger if exists trg_touch_custom_questions on public.custom_questions;
create trigger trg_touch_custom_questions before update on public.custom_questions for each row execute function app.touch_updated_at();
drop trigger if exists trg_touch_settings         on public.settings;
create trigger trg_touch_settings         before update on public.settings         for each row execute function app.touch_updated_at();

-- incidents -------------------------------------------------------------
drop trigger if exists trg_incidents_before_insert on public.incidents;
create trigger trg_incidents_before_insert
  before insert on public.incidents
  for each row execute function app.incidents_before_insert();

drop trigger if exists trg_incidents_status_guard on public.incidents;
create trigger trg_incidents_status_guard
  before update on public.incidents
  for each row when (old.status is distinct from new.status)
  execute function app.incidents_status_guard();

-- GPS pipeline ------------------------------------------------------------
drop trigger if exists trg_location_after_insert on public.rrt_locations;
create trigger trg_location_after_insert
  after insert on public.rrt_locations
  for each row execute function app.on_location_insert();

drop trigger if exists trg_teams_became_available on public.rrt_teams;
create trigger trg_teams_became_available
  after update of status on public.rrt_teams
  for each row when (new.status = 'AVAILABLE' and old.status is distinct from new.status)
  execute function app.teams_became_available();

-- users ---------------------------------------------------------------------
drop trigger if exists trg_users_guard on public.users;
create trigger trg_users_guard
  before insert or update on public.users
  for each row execute function app.users_guard();

-- hygiene ----------------------------------------------------------------------
drop trigger if exists trg_towers_normalize on public.towers;
create trigger trg_towers_normalize
  before insert or update on public.towers
  for each row execute function app.towers_normalize();

drop trigger if exists trg_forms_single_default on public.custom_forms;
create trigger trg_forms_single_default
  before insert or update of is_default on public.custom_forms
  for each row execute function app.forms_single_default();

drop trigger if exists trg_questions_bump_version on public.custom_questions;
create trigger trg_questions_bump_version
  after insert or update or delete on public.custom_questions
  for each row execute function app.forms_bump_version();

drop trigger if exists trg_settings_validate on public.settings;
create trigger trg_settings_validate
  before insert or update on public.settings
  for each row execute function app.settings_validate();

-- push --------------------------------------------------------------------------
drop trigger if exists trg_notifications_push on public.notifications;
create trigger trg_notifications_push
  after insert on public.notifications
  for each row execute function app.push_notification();

-- audit ------------------------------------------------------------------------
drop trigger if exists trg_audit_towers on public.towers;
create trigger trg_audit_towers
  after insert or update or delete on public.towers
  for each row execute function app.audit_row();

drop trigger if exists trg_audit_users on public.users;
create trigger trg_audit_users
  after insert or update or delete on public.users
  for each row execute function app.audit_row();

drop trigger if exists trg_audit_custom_forms on public.custom_forms;
create trigger trg_audit_custom_forms
  after insert or update or delete on public.custom_forms
  for each row execute function app.audit_row();

drop trigger if exists trg_audit_custom_questions on public.custom_questions;
create trigger trg_audit_custom_questions
  after insert or update or delete on public.custom_questions
  for each row execute function app.audit_row();

drop trigger if exists trg_audit_settings on public.settings;
create trigger trg_audit_settings
  after insert or update or delete on public.settings
  for each row execute function app.audit_row();

-- rrt_teams: log creation, deletion and meaningful edits (not every GPS ping)
drop trigger if exists trg_audit_rrt_teams_ins on public.rrt_teams;
create trigger trg_audit_rrt_teams_ins
  after insert or delete on public.rrt_teams
  for each row execute function app.audit_row();

drop trigger if exists trg_audit_rrt_teams_upd on public.rrt_teams;
create trigger trg_audit_rrt_teams_upd
  after update on public.rrt_teams
  for each row
  when ((old.code, old.name, old.mobile, old.vehicle_plate, old.vehicle_model, old.region, old.is_active, old.is_online_enabled)
        is distinct from
        (new.code, new.name, new.mobile, new.vehicle_plate, new.vehicle_model, new.region, new.is_active, new.is_online_enabled))
  execute function app.audit_row();

-- incidents: log creation and every status change
drop trigger if exists trg_audit_incidents_ins on public.incidents;
create trigger trg_audit_incidents_ins
  after insert or delete on public.incidents
  for each row execute function app.audit_row();

drop trigger if exists trg_audit_incidents_upd on public.incidents;
create trigger trg_audit_incidents_upd
  after update on public.incidents
  for each row
  when (old.status is distinct from new.status or old.assigned_team_id is distinct from new.assigned_team_id)
  execute function app.audit_row();

-- =====================================================================
-- Function privileges
-- =====================================================================
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

-- <<<<<<<<<< END 0006_triggers.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0007_views.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0007_views.sql
-- PERS Telecom Security - Phase 1 / Step 7 of 10: views
--
-- Every view is SECURITY INVOKER, so Row Level Security of the
-- underlying tables applies to whoever queries the view.
--
--   v_rrt_live              map markers (derives OFFLINE from stale GPS)
--   v_dashboard_stats       the seven live tiles
--   v_incident_detail       incident list / detail screen
--   v_incident_offers       the escalation chain of an incident
--   v_report_incidents      one flat row per incident for PDF / Excel / CSV
--   v_tower_incident_counts tower details panel
-- Safe to re-run (create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- v_rrt_live
-- live_status is what the map shows: a team whose GPS is older than
-- offline_after_seconds is OFFLINE (red) even if it is on an incident;
-- its assignment fields stay filled so the operator still sees it.
-- ---------------------------------------------------------------------
create or replace view public.v_rrt_live
with (security_invoker = true) as
select
  t.id,
  t.code,
  t.name,
  t.mobile,
  t.vehicle_plate,
  t.vehicle_model,
  t.region,
  t.is_active,
  t.is_simulated,
  t.is_online_enabled,
  t.status                         as db_status,
  case when t.is_stale then 'OFFLINE'::public.team_status else t.status end as live_status,
  t.is_stale,
  t.last_lat                       as lat,
  t.last_lng                       as lng,
  t.last_speed_kmh                 as speed_kmh,
  t.last_heading                   as heading,
  t.last_accuracy_m                as accuracy_m,
  t.last_seen_at,
  t.current_incident_id,
  i.incident_number,
  i.status                         as incident_status,
  i.accepted_at,
  i.eta_seconds,
  i.distance_remaining_m,
  tw.tower_number,
  tw.site_name                     as tower_name,
  tw.lat                           as tower_lat,
  tw.lng                           as tower_lng
from (
  select rt.*,
         (rt.last_seen_at is null
          or rt.last_seen_at < now() - make_interval(secs => app.setting_num('offline_after_seconds', 45)::double precision)
         ) as is_stale
    from public.rrt_teams rt
) t
left join public.incidents i  on i.id  = t.current_incident_id
left join public.towers    tw on tw.id = i.tower_id;

-- ---------------------------------------------------------------------
-- v_dashboard_stats (always exactly one row)
--   online_rrt   = teams that are online and AVAILABLE (green on the map)
--   online_total = every team that is not OFFLINE (green + yellow + blue)
-- ---------------------------------------------------------------------
create or replace view public.v_dashboard_stats
with (security_invoker = true) as
select
  (select count(*) from public.towers where deleted_at is null)                                       as total_towers,
  (select count(*) from public.towers where deleted_at is null and status = 'ACTIVE')                  as active_towers,
  (select count(*) from public.incidents where status in ('OPEN', 'ASSIGNED', 'REACHED'))              as active_incidents,
  (select count(*) from public.incidents where status = 'OPEN')                                        as open_incidents,
  (select count(*) from public.v_rrt_live where is_active and live_status = 'AVAILABLE')               as online_rrt,
  (select count(*) from public.v_rrt_live where is_active and live_status = 'ASSIGNED')                as assigned_rrt,
  (select count(*) from public.v_rrt_live where is_active and live_status = 'REACHED')                 as reached_rrt,
  (select count(*) from public.v_rrt_live where is_active and live_status = 'OFFLINE')                 as offline_rrt,
  (select count(*) from public.v_rrt_live where is_active and live_status <> 'OFFLINE')                as online_total,
  (select count(*) from public.incidents
    where status = 'RESOLVED'
      and resolved_at >= (date_trunc('day', now() at time zone app.report_tz()) at time zone app.report_tz())
  )                                                                                                     as resolved_today;

-- ---------------------------------------------------------------------
-- v_incident_detail
-- ---------------------------------------------------------------------
create or replace view public.v_incident_detail
with (security_invoker = true) as
select
  i.id,
  i.incident_number,
  i.status,
  i.dispatch_state,
  i.dispatch_round,
  i.source,
  i.region,
  i.triggered_at,
  i.accepted_at,
  i.reached_at,
  i.reached_manually,
  i.resolved_at,
  i.cancelled_at,
  i.cancel_reason,
  i.eta_seconds,
  i.eta_updated_at,
  i.distance_remaining_m,
  i.route_distance_m,
  i.route_geojson,
  i.accept_seconds,
  i.travel_seconds,
  i.response_seconds,
  i.onsite_seconds,
  i.resolution_seconds,
  i.notes,
  i.form_id,
  i.is_demo_seed,
  i.tower_id,
  tw.tower_number,
  tw.site_name        as tower_name,
  tw.lat              as tower_lat,
  tw.lng              as tower_lng,
  tw.status           as tower_status,
  i.assigned_team_id,
  t.code              as team_code,
  t.name              as team_name,
  t.mobile            as team_mobile,
  t.last_lat          as team_lat,
  t.last_lng          as team_lng,
  t.last_speed_kmh    as team_speed_kmh,
  t.last_seen_at      as team_last_seen_at,
  i.triggered_by,
  u.full_name         as triggered_by_name,
  (select count(*) from public.incident_assignments a where a.incident_id = i.id) as offers_count,
  cur.team_id         as pending_team_id,
  cur.expires_at      as pending_expires_at,
  pt.code             as pending_team_code,
  pt.name             as pending_team_name
from public.incidents i
join public.towers tw on tw.id = i.tower_id
left join public.rrt_teams t on t.id = i.assigned_team_id
left join public.users u     on u.id = i.triggered_by
left join lateral (
  select a.team_id, a.expires_at
    from public.incident_assignments a
   where a.incident_id = i.id and a.status = 'PENDING'
   limit 1
) cur on true
left join public.rrt_teams pt on pt.id = cur.team_id;

-- ---------------------------------------------------------------------
-- v_incident_offers : escalation chain, one row per offer
-- ---------------------------------------------------------------------
create or replace view public.v_incident_offers
with (security_invoker = true) as
select
  a.id,
  a.incident_id,
  a.sequence_no,
  a.round_no,
  a.team_id,
  t.code  as team_code,
  t.name  as team_name,
  a.distance_km,
  a.status,
  a.manual,
  a.offered_at,
  a.expires_at,
  a.responded_at,
  a.response_reason,
  (extract(epoch from (a.responded_at - a.offered_at)))::integer as response_seconds
from public.incident_assignments a
join public.rrt_teams t on t.id = a.team_id;

-- ---------------------------------------------------------------------
-- v_report_incidents : one flat row per incident for the reports module
-- ---------------------------------------------------------------------
create or replace view public.v_report_incidents
with (security_invoker = true) as
select
  i.id                 as incident_id,
  i.incident_number,
  tw.tower_number,
  tw.site_name         as tower_name,
  i.region,
  tw.lat               as tower_lat,
  tw.lng               as tower_lng,
  i.status,
  i.triggered_at,
  t.code               as team_code,
  t.name               as assigned_rrt,
  i.accepted_at,
  i.reached_at,
  i.reached_manually,
  i.resolved_at,
  i.cancel_reason,
  i.accept_seconds,
  i.travel_seconds,
  i.response_seconds,
  i.onsite_seconds,
  i.resolution_seconds,
  coalesce(ofr.offers_count, 0)            as offers_count,
  coalesce(ofr.first_offer_accepted, false) as first_offer_accepted,
  coalesce(ans.answers, '[]'::jsonb)       as answers,
  coalesce(ph.photos,   '[]'::jsonb)       as photos,
  coalesce(ph.photo_count, 0)              as photo_count,
  i.route_geojson
from public.incidents i
join public.towers tw on tw.id = i.tower_id
left join public.rrt_teams t on t.id = i.assigned_team_id
left join lateral (
  select count(*) as offers_count,
         bool_or(a.status = 'ACCEPTED' and a.sequence_no = 1) as first_offer_accepted
    from public.incident_assignments a
   where a.incident_id = i.id
) ofr on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
           'question', a.question_label,
           'type',     a.question_type,
           'value',    a.value)
         order by cq.position nulls last, a.answered_at) as answers
    from public.incident_answers a
    left join public.custom_questions cq on cq.id = a.question_id
   where a.incident_id = i.id
) ans on true
left join lateral (
  select count(*) as photo_count,
         jsonb_agg(jsonb_build_object(
           'path',      p.storage_path,
           'thumb_path', p.thumb_path,
           'file_name', p.file_name,
           'mime_type', p.mime_type,
           'kind',      p.kind,
           'question',  cq.label)
         order by p.created_at) as photos
    from public.incident_photos p
    left join public.custom_questions cq on cq.id = p.question_id
   where p.incident_id = i.id
) ph on true;

-- ---------------------------------------------------------------------
-- v_tower_incident_counts : tower details panel
-- ---------------------------------------------------------------------
create or replace view public.v_tower_incident_counts
with (security_invoker = true) as
select
  tw.id                                                              as tower_id,
  tw.tower_number,
  tw.site_name,
  tw.region,
  tw.status,
  count(i.id)                                                        as total_incidents,
  count(i.id) filter (where i.status in ('OPEN', 'ASSIGNED', 'REACHED')) as open_incidents,
  count(i.id) filter (where i.status = 'RESOLVED')                   as resolved_incidents,
  max(i.triggered_at)                                                as last_incident_at,
  round(avg(i.response_seconds))                                     as avg_response_seconds
from public.towers tw
left join public.incidents i on i.tower_id = tw.id
where tw.deleted_at is null
group by tw.id;

-- <<<<<<<<<< END 0007_views.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0008_rls_policies.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0008_rls_policies.sql
-- PERS Telecom Security - Phase 1 / Step 8 of 10: Row Level Security
--
-- Default is DENY. Every table has RLS switched on; policies then grant
-- exactly what each role needs. All state changes go through the
-- SECURITY DEFINER functions of step 5, so most tables have NO insert /
-- update / delete policy for signed-in users on purpose.
--
-- Roles: SUPER_ADMIN, ADMIN, OPERATOR (control room) and RRT_MEMBER.
-- Anonymous visitors (not signed in) get nothing.
-- Safe to re-run (drop policy if exists + create policy).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Table privileges
-- Supabase normally grants these automatically, but newer projects can be
-- configured not to, so they are stated explicitly here. Row level
-- security (below) decides which ROWS each signed-in user may touch.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all                            on all tables in schema public to service_role;
grant usage, select                  on all sequences in schema public to authenticated, service_role;

-- Nothing at all for anonymous visitors
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------
-- 1. Switch RLS on for all 14 tables
-- ---------------------------------------------------------------------
alter table public.roles                enable row level security;
alter table public.users                enable row level security;
alter table public.rrt_teams            enable row level security;
alter table public.rrt_locations        enable row level security;
alter table public.towers               enable row level security;
alter table public.incidents            enable row level security;
alter table public.incident_assignments enable row level security;
alter table public.custom_forms         enable row level security;
alter table public.custom_questions     enable row level security;
alter table public.incident_answers     enable row level security;
alter table public.incident_photos      enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.settings             enable row level security;

-- ---------------------------------------------------------------------
-- roles : everyone signed in may read; nobody edits from the API
-- ---------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- users
--   read   : own row; staff read everyone (names and phones)
--   update : own row (phone, push subscriptions; privileged columns are
--            protected by the users_guard trigger); Super Admin any row;
--            Administrator operators and RRT members only
--   create / delete : only through the secret key (server route)
-- ---------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or (select app.is_staff()));

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (
    id = (select auth.uid())
    or (select app.is_super())
    or ((select app.is_admin())
        and exists (select 1 from public.roles r
                     where r.id = users.role_id and r.code in ('OPERATOR', 'RRT_MEMBER')))
  )
  with check (
    id = (select auth.uid())
    or (select app.is_super())
    or ((select app.is_admin())
        and exists (select 1 from public.roles r
                     where r.id = users.role_id and r.code in ('OPERATOR', 'RRT_MEMBER')))
  );

-- ---------------------------------------------------------------------
-- rrt_teams
--   read   : staff all; an RRT member reads their own team
--   write  : admins (add, edit, deactivate); delete: Super Admin only.
--   Live columns (status, position) change only through functions.
-- ---------------------------------------------------------------------
drop policy if exists rrt_teams_select on public.rrt_teams;
create policy rrt_teams_select on public.rrt_teams
  for select to authenticated
  using ((select app.is_staff()) or id = (select app.team_id()));

drop policy if exists rrt_teams_insert on public.rrt_teams;
create policy rrt_teams_insert on public.rrt_teams
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists rrt_teams_update on public.rrt_teams;
create policy rrt_teams_update on public.rrt_teams
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists rrt_teams_delete on public.rrt_teams;
create policy rrt_teams_delete on public.rrt_teams
  for delete to authenticated
  using ((select app.is_super()));

-- ---------------------------------------------------------------------
-- rrt_locations : staff read all, a team reads its own. Rows are written
-- only by public.post_location (no insert policy).
-- ---------------------------------------------------------------------
drop policy if exists rrt_locations_select on public.rrt_locations;
create policy rrt_locations_select on public.rrt_locations
  for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.team_id()));

-- ---------------------------------------------------------------------
-- towers
--   read   : staff all; an RRT member only towers of incidents offered
--            to or handled by their team
--   write  : administrators
-- ---------------------------------------------------------------------
drop policy if exists towers_select on public.towers;
create policy towers_select on public.towers
  for select to authenticated
  using (
    (select app.is_staff())
    or exists (
      select 1
        from public.incidents i
       where i.tower_id = towers.id
         and (i.assigned_team_id = (select app.team_id())
              or exists (select 1 from public.incident_assignments a
                          where a.incident_id = i.id
                            and a.team_id = (select app.team_id())))
    )
  );

drop policy if exists towers_insert on public.towers;
create policy towers_insert on public.towers
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists towers_update on public.towers;
create policy towers_update on public.towers
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists towers_delete on public.towers;
create policy towers_delete on public.towers
  for delete to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- incidents
--   read   : staff all; an RRT member incidents offered to / handled by
--            their team. Changes only through functions.
--   delete : Super Admin only
-- ---------------------------------------------------------------------
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents
  for select to authenticated
  using (
    (select app.is_staff())
    or assigned_team_id = (select app.team_id())
    or exists (select 1 from public.incident_assignments a
                where a.incident_id = incidents.id
                  and a.team_id = (select app.team_id()))
  );

drop policy if exists incidents_delete on public.incidents;
create policy incidents_delete on public.incidents
  for delete to authenticated
  using ((select app.is_super()));

-- ---------------------------------------------------------------------
-- incident_assignments : staff all; a team reads its own offers.
-- Changes only through functions.
-- ---------------------------------------------------------------------
drop policy if exists incident_assignments_select on public.incident_assignments;
create policy incident_assignments_select on public.incident_assignments
  for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.team_id()));

-- ---------------------------------------------------------------------
-- custom_forms / custom_questions
--   read  : staff and RRT members (they must render the form)
--   write : administrators
-- ---------------------------------------------------------------------
drop policy if exists custom_forms_select on public.custom_forms;
create policy custom_forms_select on public.custom_forms
  for select to authenticated
  using ((select app.is_staff()) or (select app.team_id()) is not null);

drop policy if exists custom_forms_insert on public.custom_forms;
create policy custom_forms_insert on public.custom_forms
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists custom_forms_update on public.custom_forms;
create policy custom_forms_update on public.custom_forms
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists custom_forms_delete on public.custom_forms;
create policy custom_forms_delete on public.custom_forms
  for delete to authenticated
  using ((select app.is_admin()));

drop policy if exists custom_questions_select on public.custom_questions;
create policy custom_questions_select on public.custom_questions
  for select to authenticated
  using ((select app.is_staff()) or (select app.team_id()) is not null);

drop policy if exists custom_questions_insert on public.custom_questions;
create policy custom_questions_insert on public.custom_questions
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists custom_questions_update on public.custom_questions;
create policy custom_questions_update on public.custom_questions
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists custom_questions_delete on public.custom_questions;
create policy custom_questions_delete on public.custom_questions
  for delete to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- incident_answers : staff all; a team reads answers of its own incidents.
-- Rows are written only by public.resolve_incident.
-- ---------------------------------------------------------------------
drop policy if exists incident_answers_select on public.incident_answers;
create policy incident_answers_select on public.incident_answers
  for select to authenticated
  using (
    (select app.is_staff())
    or exists (select 1 from public.incidents i
                where i.id = incident_answers.incident_id
                  and i.assigned_team_id = (select app.team_id()))
  );

-- ---------------------------------------------------------------------
-- incident_photos
--   read   : staff all; a team its own incidents
--   insert : staff; a team for its own ACTIVE incident (the phone inserts
--            the row right after uploading the file to Storage)
--   delete : administrators; a team may remove its own upload while the
--            incident is still active
-- ---------------------------------------------------------------------
drop policy if exists incident_photos_select on public.incident_photos;
create policy incident_photos_select on public.incident_photos
  for select to authenticated
  using (
    (select app.is_staff())
    or exists (select 1 from public.incidents i
                where i.id = incident_photos.incident_id
                  and i.assigned_team_id = (select app.team_id()))
  );

drop policy if exists incident_photos_insert on public.incident_photos;
create policy incident_photos_insert on public.incident_photos
  for insert to authenticated
  with check (
    (select app.is_staff())
    or (uploaded_by = (select auth.uid())
        and exists (select 1 from public.incidents i
                     where i.id = incident_photos.incident_id
                       and i.assigned_team_id = (select app.team_id())
                       and i.status in ('ASSIGNED', 'REACHED')))
  );

drop policy if exists incident_photos_delete on public.incident_photos;
create policy incident_photos_delete on public.incident_photos
  for delete to authenticated
  using (
    (select app.is_admin())
    or (uploaded_by = (select auth.uid())
        and exists (select 1 from public.incidents i
                     where i.id = incident_photos.incident_id
                       and i.assigned_team_id = (select app.team_id())
                       and i.status in ('ASSIGNED', 'REACHED')))
  );

-- ---------------------------------------------------------------------
-- notifications : each user reads, marks read and deletes only their own.
-- Rows are created only by database functions.
-- ---------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- audit_logs : administrators read; nobody writes (trigger only)
-- ---------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- settings : every signed-in user reads (the phone needs timeouts);
-- only a Super Admin edits.
-- ---------------------------------------------------------------------
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (true);

drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to authenticated
  with check ((select app.is_super()));

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using ((select app.is_super()))
  with check ((select app.is_super()));

drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings
  for delete to authenticated
  using ((select app.is_super()));

-- ---------------------------------------------------------------------
-- Defence in depth: remove direct write privileges where only the
-- database functions may write. (Functions run as the table owner.)
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.roles                from authenticated;
revoke insert, update, delete, truncate on public.rrt_locations        from authenticated;
revoke insert, update, delete, truncate on public.incident_assignments from authenticated;
revoke insert, update, delete, truncate on public.incident_answers     from authenticated;
revoke insert, update, delete, truncate on public.audit_logs           from authenticated;
revoke insert,         delete, truncate on public.users                from authenticated;
revoke insert, update,         truncate on public.incidents            from authenticated;
revoke truncate on public.towers, public.rrt_teams, public.custom_forms,
                   public.custom_questions, public.incident_photos,
                   public.notifications, public.settings              from authenticated;

-- <<<<<<<<<< END 0008_rls_policies.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0009_storage_realtime_cron.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0009_storage_realtime_cron.sql
-- PERS Telecom Security - Phase 1 / Step 9 of 10: storage, realtime, cron
--
--   1. Private Storage bucket "incident-media" + access policies
--   2. Realtime publication (live map, live dashboard, live offers)
--   3. Background jobs (pg_cron): offer expiry, retries, offline sweep,
--      GPS history clean-up
--
-- Every block is guarded: if a feature is not available on your project
-- (for example pg_cron not enabled yet) this file prints a NOTICE and
-- carries on instead of failing. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STORAGE
-- File path convention:  <incident_number>/<anything>.<ext>
--   e.g.  INC-2026-000012/9f3c....jpg
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage schema not found - skipping bucket creation (not a Supabase project?)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'incident-media',
    'incident-media',
    false,                                  -- private: files are opened with short-lived signed links
    15 * 1024 * 1024,                       -- 15 MB per file (the phone shrinks photos before upload)
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
          'application/pdf', 'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  )
  on conflict (id) do update
    set public             = false,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception when others then
  raise notice 'Could not create the incident-media bucket automatically (%). Create it by hand: Storage > New bucket > name incident-media > Private.', sqlerrm;
end
$$;

-- Who may touch a file?  The folder name is the incident number.
--   * control-room staff: read everything, delete when administrator
--   * an RRT member: read / upload / replace files of the incident that is
--     assigned to their own team (upload only while it is ASSIGNED or REACHED)
create or replace function app.can_read_media(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_staff()
      or exists (
           select 1
             from public.incidents i
            where i.incident_number = (storage.foldername(p_object_name))[1]
              and i.assigned_team_id is not null
              and i.assigned_team_id = app.team_id());
$$;

create or replace function app.can_write_media(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or exists (
           select 1
             from public.incidents i
            where i.incident_number = (storage.foldername(p_object_name))[1]
              and i.assigned_team_id is not null
              and i.assigned_team_id = app.team_id()
              and i.status in ('ASSIGNED', 'REACHED'));
$$;

revoke all on function app.can_read_media(text)  from public, anon;
revoke all on function app.can_write_media(text) from public, anon;
grant execute on function app.can_read_media(text)  to authenticated, service_role;
grant execute on function app.can_write_media(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists "pers_media_select" on storage.objects;
  drop policy if exists "pers_media_insert" on storage.objects;
  drop policy if exists "pers_media_update" on storage.objects;
  drop policy if exists "pers_media_delete" on storage.objects;

  create policy "pers_media_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'incident-media' and app.can_read_media(name));

  create policy "pers_media_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'incident-media' and app.can_write_media(name));

  create policy "pers_media_update" on storage.objects
    for update to authenticated
    using      (bucket_id = 'incident-media' and app.can_write_media(name))
    with check (bucket_id = 'incident-media' and app.can_write_media(name));

  create policy "pers_media_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'incident-media' and app.can_write_media(name));
exception when others then
  raise notice 'Could not create storage policies automatically (%). Add them in Storage > Policies using the rules documented in docs/PHASE1_SETUP_GUIDE.md.', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------
-- 2. REALTIME
-- The apps subscribe to these tables. RLS still applies to every event, so
-- each user only receives rows they are allowed to see.
-- rrt_locations is NOT published: the map reads the live position from
-- rrt_teams, and the history table would flood the channel.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['rrt_teams', 'incidents', 'incident_assignments',
                           'notifications', 'towers', 'incident_photos']
  loop
    begin
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      -- FULL lets "UPDATE" and "DELETE" events carry the old row too
      execute format('alter table public.%I replica identity full', t);
    exception when others then
      raise notice 'Could not publish table % to realtime: %', t, sqlerrm;
    end;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 3. HOUSEKEEPING FUNCTION: delete old GPS history and old notifications
-- ---------------------------------------------------------------------
create or replace function app.purge_old_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days  integer := app.setting_num('location_retention_days', 30)::integer;
  v_loc   integer;
  v_notif integer;
begin
  delete from public.rrt_locations
   where received_at < now() - make_interval(days => v_days);
  get diagnostics v_loc = row_count;

  delete from public.notifications
   where created_at < now() - make_interval(days => greatest(v_days, 30));
  get diagnostics v_notif = row_count;

  return jsonb_build_object('locations_deleted', v_loc, 'notifications_deleted', v_notif);
end
$$;

revoke all on function app.purge_old_data() from public, anon;
grant execute on function app.purge_old_data() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3b. DEMO HEARTBEAT: simulated teams have no phone, so the database keeps
-- the idle ones "alive" (fresh GPS timestamp, at their current position).
-- A simulated team that is on an incident is NOT touched: the Demo
-- Controller moves it with post_location. A simulated team switched off
-- with set_team_online(false) is left alone too.
-- ---------------------------------------------------------------------
create or replace function app.simulated_heartbeat()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.rrt_teams t
     set last_lat        = coalesce(t.last_lat, t.home_lat),
         last_lng        = coalesce(t.last_lng, t.home_lng),
         last_speed_kmh  = 0,
         last_accuracy_m = coalesce(t.last_accuracy_m, 5),
         last_seen_at    = now(),
         stale_alerted   = false,
         status          = case when t.status = 'OFFLINE' then 'AVAILABLE'::public.team_status else t.status end
   where t.is_simulated
     and t.is_active
     and t.is_online_enabled
     and t.current_incident_id is null
     and coalesce(t.last_lat, t.home_lat) is not null;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function app.simulated_heartbeat() from public, anon;
grant execute on function app.simulated_heartbeat() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. BACKGROUND JOBS (pg_cron)
--   every  5 s : expire unanswered 30-second offers and offer the next team
--   every 10 s : keep idle SIMULATED demo teams online (heartbeat)
--   every 15 s : retry incidents that ran out of teams, offer waiting
--                incidents to newly free teams, mark silent teams OFFLINE
--   daily 03:10 (server time) : purge old GPS history
-- Sub-minute schedules need pg_cron 1.5 or newer (every current Supabase
-- project has it). On older versions the 5/15 s jobs fall back to 1 minute.
-- ---------------------------------------------------------------------
do $$
declare
  v_jobs jsonb := jsonb_build_array(
    jsonb_build_array('pers_expire_offers',  '5 seconds',  'select app.process_expired_offers()'),
    jsonb_build_array('pers_retry_exhausted','15 seconds', 'select app.retry_exhausted_incidents()'),
    jsonb_build_array('pers_redispatch',     '15 seconds', 'select app.redispatch_waiting_incidents()'),
    jsonb_build_array('pers_mark_offline',   '15 seconds', 'select app.mark_offline_teams()'),
    jsonb_build_array('pers_sim_heartbeat',  '10 seconds', 'select app.simulated_heartbeat()'),
    jsonb_build_array('pers_purge_old_data', '10 3 * * *', 'select app.purge_old_data()')
  );
  j jsonb;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not enabled. Enable it in Database > Extensions, then run this file again. The dispatch engine will NOT escalate unanswered offers until the jobs exist.';
    return;
  end if;

  for j in select * from jsonb_array_elements(v_jobs)
  loop
    begin
      perform cron.schedule(j ->> 0, j ->> 1, j ->> 2);
    exception when others then
      begin
        -- older pg_cron: no sub-minute schedules
        perform cron.schedule(j ->> 0, '* * * * *', j ->> 2);
        raise notice 'Job % scheduled every minute (sub-minute schedule not supported here)', j ->> 0;
      exception when others then
        raise notice 'Could not schedule job %: %', j ->> 0, sqlerrm;
      end;
    end;
  end loop;
end
$$;

-- <<<<<<<<<< END 0009_storage_realtime_cron.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN 0010_reference_data.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/migrations/0010_reference_data.sql
-- PERS Telecom Security - Phase 1 / Step 10 of 10: reference data
--
-- Data the system cannot run without (NOT demo data):
--   * the four roles
--   * the tunable settings
--   * the default resolution form with its questions
-- Safe to run more than once: existing rows are updated, never duplicated.
-- Settings you have changed in the Admin panel are NOT overwritten.
-- =====================================================================

-- Do not fill the audit log with installation noise.
select set_config('pers.skip_audit', 'on', true);

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
insert into public.roles (id, code, name, description) values
  (1, 'SUPER_ADMIN', 'Super Admin', 'Full control, including administrators and system settings'),
  (2, 'ADMIN',       'Administrator', 'Manages towers, RRT teams, users, forms and reports'),
  (3, 'OPERATOR',    'Operator', 'Control-room operator: monitors the map and triggers incidents'),
  (4, 'RRT_MEMBER',  'RRT Member', 'Field team: receives offers, navigates, resolves incidents')
on conflict (id) do update
  set code = excluded.code,
      name = excluded.name,
      description = excluded.description;

-- ---------------------------------------------------------------------
-- Settings (inserted only when missing, so later edits survive a re-run)
-- ---------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('offer_timeout_seconds',   '30'::jsonb,   'Seconds a team has to accept an incident offer before it moves to the next nearest team'),
  ('retry_interval_seconds',  '60'::jsonb,   'Seconds to wait before offering again when every team has declined or timed out'),
  ('max_dispatch_rounds',     '3'::jsonb,    'How many full rounds of offers are made automatically before an operator must assign manually'),
  ('offline_after_seconds',   '45'::jsonb,   'A team with no GPS signal for this long is shown as OFFLINE'),
  ('gps_interval_seconds',    '5'::jsonb,    'How often the team phone sends its position while online'),
  ('arrival_radius_m',        '50'::jsonb,   'A team within this distance (metres) of the tower is marked REACHED automatically'),
  ('arrival_max_accuracy_m',  '100'::jsonb,  'GPS readings less accurate than this (metres) are ignored for arrival detection'),
  ('default_speed_kmh',       '40'::jsonb,   'Speed used to estimate arrival time when the team is not moving yet'),
  ('eta_fresh_seconds',       '90'::jsonb,   'How long a road-route ETA from Mapbox is trusted before the straight-line estimate is used'),
  ('location_retention_days', '30'::jsonb,   'GPS history older than this many days is deleted automatically'),
  ('report_timezone',         '"Asia/Kolkata"'::jsonb, 'Time zone used for "today" and for every report'),
  ('brand_name',              '"PERS Telecom Security"'::jsonb, 'Name shown in the app header and on reports'),
  ('demo_city',               '"Gurugram, Haryana, India"'::jsonb, 'City used by the demo data'),
  ('map_default_center',      '{"lat": 28.4595, "lng": 77.0266}'::jsonb, 'Map centre when the dashboard opens (Gurugram)'),
  ('map_default_zoom',        '11'::jsonb,   'Map zoom when the dashboard opens')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Default resolution form (fixed ids so this file can be re-run)
-- ---------------------------------------------------------------------
insert into public.custom_forms (id, name, description, is_active, is_default)
values ('f0000000-0000-4000-8000-000000000001',
        'Standard Resolution Report',
        'Filled in by the RRT member when an incident is resolved',
        true, true)
on conflict (id) do nothing;

insert into public.custom_questions
  (id, form_id, position, label, help_text, type, is_required,
   scale_min, scale_max, options, multiline, min_files, max_files)
values
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 1,
   'Was the problem fixed on site?', null, 'YES_NO', true,
   null, null, '[]'::jsonb, false, 0, 5),

  ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 2,
   'Root cause', 'Pick the closest match', 'DROPDOWN', true,
   null, null,
   '["Power failure", "Battery or DC system", "Equipment fault", "Fiber or transmission cut", "Theft or vandalism", "Unauthorized access", "Weather or environment", "Other"]'::jsonb,
   false, 0, 5),

  ('f1000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 3,
   'Work done and remarks', 'Describe what you found and what you did', 'TEXT', true,
   null, null, '[]'::jsonb, true, 0, 5),

  ('f1000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', 4,
   'Site condition after the visit', '1 = poor, 5 = excellent', 'RATING', false,
   1, 5, '[]'::jsonb, false, 0, 5),

  ('f1000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000001', 5,
   'Items replaced or repaired', 'Select everything that applies', 'MULTI_SELECT', false,
   null, null,
   '["Battery", "Rectifier", "Lock or door", "Cable", "Antenna", "Generator", "Cooling or fan", "Nothing replaced"]'::jsonb,
   false, 0, 5),

  ('f1000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000001', 6,
   'Photos of the site', 'At least one photo after the work is finished', 'PHOTO', true,
   null, null, '[]'::jsonb, false, 1, 5)
on conflict (id) do nothing;

-- <<<<<<<<<< END 0010_reference_data.sql <<<<<<<<<<

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

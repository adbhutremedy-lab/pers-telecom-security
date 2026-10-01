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

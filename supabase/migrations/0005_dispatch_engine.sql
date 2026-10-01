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

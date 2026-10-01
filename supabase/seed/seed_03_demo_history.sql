-- =====================================================================
-- FILE: supabase/seed/seed_03_demo_history.sql
-- PERS Telecom Security - Phase 1 seed 3 of 3: demo incident history
--
-- Creates about 54 finished incidents spread over the last 14 days, each with
-- its offer chain and resolution answers, so the dashboard, reports and
-- charts are not empty on day one.
--   * 48 RESOLVED, 6 CANCELLED
--   * marked is_demo_seed = true, so "Reset demo" keeps them
-- Run AFTER seed_01 and seed_02. Does nothing if the history already exists.
-- Times are relative to the moment you run it ("14 days ago until now").
-- =====================================================================

select set_config('pers.skip_audit', 'on', true);

do $$
declare
  c_resolved constant integer := 48;
  c_cancelled constant integer := 6;
  v_form      uuid;
  v_operator  uuid;
  v_towers    uuid[];
  v_teams     uuid[];
  r           record;
  v_tower     public.towers%rowtype;
  v_team      public.rrt_teams%rowtype;
  v_wrong     public.rrt_teams%rowtype;
  v_inc       uuid;
  v_dist      double precision;
  v_dist2     double precision;
  v_trig      timestamptz;
  v_acc       timestamptz;
  v_reach     timestamptz;
  v_res       timestamptz;
  v_speed     double precision;
  v_first_delay integer;
  v_second     boolean;
  v_cause     text;
  v_items     jsonb;
  v_notes     text;
  v_rating    integer;
  v_causes    text[] := array['Power failure', 'Battery or DC system', 'Equipment fault',
                              'Fiber or transmission cut', 'Theft or vandalism',
                              'Unauthorized access', 'Weather or environment', 'Other'];
  v_item_list text[] := array['Battery', 'Rectifier', 'Lock or door', 'Cable',
                              'Antenna', 'Generator', 'Cooling or fan', 'Nothing replaced'];
  v_remarks   text[] := array[
    'Mains supply was down. Generator started and site restored.',
    'Battery bank had failed cells. Replaced and tested backup time.',
    'Door lock was forced. Replaced the lock and informed security.',
    'Fibre patch cord damaged by rodents. Replaced and sealed the duct.',
    'Rectifier module faulty. Swapped with spare, alarms cleared.',
    'Cooling fan not running. Cleaned and replaced the fan.',
    'Loose power cable at the shelter. Re-terminated and checked.',
    'False alarm caused by door sensor. Sensor re-aligned.',
    'Heavy rain water entered the cable trench. Pumped out and sealed.',
    'Site checked, all equipment normal. Alarm cleared remotely.'];
  v_cancel_reasons text[] := array['Duplicate alarm', 'False alarm confirmed by NOC',
                                   'Fault cleared remotely', 'Raised by mistake'];
  n integer;
  v_pick integer;
begin
  if exists (select 1 from public.incidents where is_demo_seed) then
    raise notice 'Demo history already present - nothing to do.';
    return;
  end if;

  select f.id into v_form from public.custom_forms f where f.is_default limit 1;
  select u.id into v_operator from public.users u where u.email = 'operator1@pers.example';

  select array_agg(t.id) into v_towers
    from public.towers t where t.status = 'ACTIVE' and t.deleted_at is null;
  select array_agg(t.id) into v_teams
    from public.rrt_teams t where t.is_active and t.home_lat is not null;

  if v_towers is null or v_teams is null then
    raise exception 'Run seed_01_towers_and_teams.sql first.';
  end if;

  perform setseed(0.42);    -- same data every time

  -- One row per incident, ordered by time so incident numbers ascend with time.
  create temporary table _hist on commit drop as
    select g as n,
           (g > c_resolved) as is_cancelled,
           now() - (random() * 13.8 + 0.1) * interval '1 day'
                 - (random() * 6) * interval '1 hour' as trig
      from generate_series(1, c_resolved + c_cancelled) g;

  for r in select * from _hist order by trig loop
    v_pick := 1 + floor(random() * array_length(v_towers, 1))::int;
    select * into v_tower from public.towers where id = v_towers[v_pick];
    v_pick := 1 + floor(random() * array_length(v_teams, 1))::int;
    select * into v_team from public.rrt_teams where id = v_teams[v_pick];
    v_dist  := public.haversine_km(v_team.home_lat, v_team.home_lng, v_tower.lat, v_tower.lng);
    v_trig  := r.trig;
    v_first_delay := 4 + floor(random() * 22)::int;
    v_second := random() < 0.25;                  -- 25 %: the first team did not answer

    if r.is_cancelled then
      insert into public.incidents
        (tower_id, status, dispatch_state, dispatch_round, source, region, triggered_by,
         triggered_at, cancelled_at, cancel_reason, form_id, is_demo_seed, created_at)
      values
        (v_tower.id, 'CANCELLED', 'DONE', 1, 'MAP_MENU', v_tower.region, v_operator,
         v_trig, v_trig + (60 + floor(random() * 240)) * interval '1 second',
         v_cancel_reasons[1 + floor(random() * 4)::int], v_form, true, v_trig)
      returning id into v_inc;

      insert into public.incident_assignments
        (incident_id, team_id, sequence_no, round_no, distance_km, status, manual,
         offered_at, expires_at, responded_at, response_reason)
      values
        (v_inc, v_team.id, 1, 1, round(v_dist::numeric, 3), 'CANCELLED', false,
         v_trig, v_trig + interval '30 seconds', v_trig + interval '45 seconds', 'Incident cancelled');
      continue;
    end if;

    -- Timeline of a resolved incident
    v_speed := 28 + random() * 17;                                  -- km/h average through traffic
    v_acc   := v_trig + v_first_delay * interval '1 second' + case when v_second then interval '31 seconds' else interval '0 seconds' end;
    v_reach := v_acc + ((v_dist * 1.3 / v_speed) * 3600 + 30 + random() * 120) * interval '1 second';
    v_res   := v_reach + (8 + random() * 47) * interval '1 minute';

    insert into public.incidents
      (tower_id, status, dispatch_state, dispatch_round, source, region, triggered_by,
       triggered_at, assigned_team_id, accepted_at, reached_at, reached_manually, resolved_at,
       eta_seconds, distance_remaining_m, route_distance_m, form_id, is_demo_seed, created_at)
    values
      (v_tower.id, 'RESOLVED', 'DONE', 1, case when random() < 0.8 then 'MAP_MENU' else 'CREATE_FORM' end::public.incident_source,
       v_tower.region, v_operator,
       v_trig, v_team.id, v_acc, v_reach, false, v_res,
       0, 20 + floor(random() * 25)::int, round(v_dist * 1300)::int, v_form, true, v_trig)
    returning id into v_inc;

    -- Offer chain
    if v_second then
      -- the nearest team was offered first and did not answer
      v_pick := 1 + floor(random() * array_length(v_teams, 1))::int;
      select * into v_wrong from public.rrt_teams where id = v_teams[v_pick];
      if v_wrong.id = v_team.id then
        v_wrong := null;
      end if;
    end if;

    if v_second and v_wrong.id is not null then
      v_dist2 := public.haversine_km(v_wrong.home_lat, v_wrong.home_lng, v_tower.lat, v_tower.lng);
      insert into public.incident_assignments
        (incident_id, team_id, sequence_no, round_no, distance_km, status, manual,
         offered_at, expires_at, responded_at, response_reason)
      values
        (v_inc, v_wrong.id, 1, 1, round(v_dist2::numeric, 3), 'EXPIRED', false,
         v_trig, v_trig + interval '30 seconds', v_trig + interval '30 seconds', 'No response in 30 seconds');
      insert into public.incident_assignments
        (incident_id, team_id, sequence_no, round_no, distance_km, status, manual,
         offered_at, expires_at, responded_at)
      values
        (v_inc, v_team.id, 2, 1, round(v_dist::numeric, 3), 'ACCEPTED', false,
         v_trig + interval '31 seconds', v_trig + interval '61 seconds', v_acc);
    else
      insert into public.incident_assignments
        (incident_id, team_id, sequence_no, round_no, distance_km, status, manual,
         offered_at, expires_at, responded_at)
      values
        (v_inc, v_team.id, 1, 1, round(v_dist::numeric, 3), 'ACCEPTED', false,
         v_trig, v_trig + interval '30 seconds', v_acc);
    end if;

    -- Resolution answers (same questions as the default form)
    v_cause  := v_causes[1 + floor(random() * 8)::int];
    v_rating := 3 + floor(random() * 3)::int;
    v_notes  := v_remarks[1 + floor(random() * 10)::int];
    v_items  := to_jsonb(array[v_item_list[1 + floor(random() * 8)::int]]);

    insert into public.incident_answers
      (incident_id, question_id, question_label, question_type, value, answered_by, answered_at)
    select v_inc, q.id, q.label, q.type,
           case q.position
             when 1 then to_jsonb(random() < 0.92)
             when 2 then to_jsonb(v_cause)
             when 3 then to_jsonb(v_notes)
             when 4 then to_jsonb(v_rating)
             when 5 then v_items
           end,
           (select u.id from public.users u where u.rrt_team_id = v_team.id limit 1),
           v_res
      from public.custom_questions q
     where q.form_id = v_form and q.position between 1 and 5;
  end loop;

  select count(*) into n from public.incidents where is_demo_seed;
  raise notice 'Demo history created: % incidents.', n;
end
$$;

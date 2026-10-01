-- =====================================================================
-- FILE: supabase/PASTE_2_all_seed_data.sql
-- PERS Telecom Security - the three seed files in one file.
-- Run AFTER PASTE_1_all_migrations.sql.
-- Creates: 100 Gurugram towers, 10 RRT teams, 14 login accounts, 54 demo incidents.
-- Safe to run more than once.
-- =====================================================================

-- >>>>>>>>>> BEGIN seed_01_towers_and_teams.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/seed/seed_01_towers_and_teams.sql
-- PERS Telecom Security - Phase 1 seed 1 of 3: demo towers and RRT teams
--
-- Demo location: Gurugram, Haryana, India
--   * 30 demo towers (coordinates are realistic for each locality but are
--     demo data, not real operator sites)
--   * 10 RRT teams: RRT-01 is the REAL Android phone, RRT-02 .. RRT-10 are
--     SIMULATED teams driven by the Demo Controller
-- Run AFTER all ten migrations. Safe to run more than once.
-- =====================================================================

select set_config('pers.skip_audit', 'on', true);

-- ---------------------------------------------------------------------
-- Towers
-- ---------------------------------------------------------------------
insert into public.towers (tower_number, site_name, lat, lng, region, status, address)
values
  ('GGN-001', 'Cyber Hub Tower',                 28.494800, 77.088500, 'Cyber City',        'ACTIVE',      'DLF Cyber Hub, DLF Cyber City, Gurugram'),
  ('GGN-002', 'DLF Cyber City Phase 3',          28.492500, 77.090500, 'Cyber City',        'ACTIVE',      'DLF Phase 3, Gurugram'),
  ('GGN-003', 'Udyog Vihar Phase 4',             28.499800, 77.082800, 'Udyog Vihar',       'ACTIVE',      'Udyog Vihar Phase 4, Gurugram'),
  ('GGN-004', 'Udyog Vihar Phase 1',             28.505000, 77.064000, 'Udyog Vihar',       'ACTIVE',      'Udyog Vihar Phase 1, Gurugram'),
  ('GGN-005', 'MG Road Sikanderpur',             28.481500, 77.093000, 'MG Road',           'ACTIVE',      'Sikanderpur, MG Road, Gurugram'),
  ('GGN-006', 'Huda City Centre',                28.459200, 77.072400, 'MG Road',           'ACTIVE',      'HUDA City Centre Metro, Gurugram'),
  ('GGN-007', 'IFFCO Chowk',                     28.472100, 77.072300, 'MG Road',           'ACTIVE',      'IFFCO Chowk, Gurugram'),
  ('GGN-008', 'Sector 29 Leisure Valley',        28.468300, 77.069000, 'MG Road',           'ACTIVE',      'Sector 29, Gurugram'),
  ('GGN-009', 'Sushant Lok Phase 1',             28.460200, 77.083500, 'MG Road',           'ACTIVE',      'Sushant Lok Phase 1, Gurugram'),
  ('GGN-010', 'Sector 43 Sikanderpur',           28.451500, 77.091000, 'Golf Course Road',  'ACTIVE',      'Sector 43, Gurugram'),
  ('GGN-011', 'Golf Course Road Sector 54',      28.442000, 77.100500, 'Golf Course Road',  'ACTIVE',      'Golf Course Road, Sector 54, Gurugram'),
  ('GGN-012', 'DLF Phase 5',                     28.447800, 77.102000, 'Golf Course Road',  'ACTIVE',      'DLF Phase 5, Gurugram'),
  ('GGN-013', 'Sector 56 Metro',                 28.424000, 77.106500, 'Golf Course Road',  'ACTIVE',      'Sector 56 Metro Station, Gurugram'),
  ('GGN-014', 'Sector 57',                       28.415000, 77.093000, 'Golf Course Road',  'ACTIVE',      'Sector 57, Gurugram'),
  ('GGN-015', 'Sohna Road Sector 49',            28.411000, 77.042000, 'Sohna Road',        'ACTIVE',      'Sohna Road, Sector 49, Gurugram'),
  ('GGN-016', 'Sohna Road Sector 47',            28.426000, 77.048000, 'Sohna Road',        'ACTIVE',      'Sohna Road, Sector 47, Gurugram'),
  ('GGN-017', 'Badshahpur',                      28.398000, 77.046000, 'Sohna Road',        'ACTIVE',      'Badshahpur, Gurugram'),
  ('GGN-018', 'Nirvana Country',                 28.405000, 77.052000, 'Sohna Road',        'ACTIVE',      'Nirvana Country, Sector 50, Gurugram'),
  ('GGN-019', 'Sector 14 Market',                28.467000, 77.030000, 'Old Gurugram',      'ACTIVE',      'Sector 14, Gurugram'),
  ('GGN-020', 'Civil Lines',                     28.459000, 77.023000, 'Old Gurugram',      'ACTIVE',      'Civil Lines, Gurugram'),
  ('GGN-021', 'Sadar Bazaar',                    28.464000, 77.017000, 'Old Gurugram',      'ACTIVE',      'Sadar Bazaar, Gurugram'),
  ('GGN-022', 'Palam Vihar',                     28.506500, 77.028500, 'Palam Vihar',       'ACTIVE',      'Palam Vihar, Gurugram'),
  ('GGN-023', 'Sector 22 Gurugram',              28.489000, 77.048000, 'Palam Vihar',       'ACTIVE',      'Sector 22, Gurugram'),
  ('GGN-024', 'Dundahera',                       28.501000, 77.058000, 'Udyog Vihar',       'ACTIVE',      'Dundahera, Gurugram'),
  ('GGN-025', 'Manesar IMT',                     28.356000, 76.939000, 'Manesar',           'ACTIVE',      'IMT Manesar, Gurugram'),
  ('GGN-026', 'Manesar Sector 1',                28.364000, 76.947000, 'Manesar',           'MAINTENANCE', 'Sector 1, IMT Manesar, Gurugram'),
  ('GGN-027', 'Dwarka Expressway Sector 84',     28.399000, 76.983000, 'Dwarka Expressway', 'ACTIVE',      'Dwarka Expressway, Sector 84, Gurugram'),
  ('GGN-028', 'Dwarka Expressway Sector 82',     28.410000, 76.996000, 'Dwarka Expressway', 'INACTIVE',    'Dwarka Expressway, Sector 82, Gurugram'),
  ('GGN-029', 'Golf Course Extension Sector 65', 28.409000, 77.069000, 'Golf Course Road',  'ACTIVE',      'Golf Course Extension Road, Sector 65, Gurugram'),
  ('GGN-030', 'Sector 67',                       28.393000, 77.064000, 'Sohna Road',        'ACTIVE',      'Sector 67, Gurugram')
on conflict (tower_number) do update
  set site_name = excluded.site_name,
      lat       = excluded.lat,
      lng       = excluded.lng,
      region    = excluded.region,
      status    = excluded.status,
      address   = excluded.address,
      deleted_at = null;

-- ---------------------------------------------------------------------
-- RRT teams
-- RRT-01  : real Android phone. Starts OFFLINE; the team member taps
--           "Go Online" on the phone.
-- RRT-02..: simulated. Start online at their base, kept alive by the
--           database heartbeat job and moved by the Demo Controller.
-- On a re-run only descriptive fields and the base position are
-- refreshed; live status and GPS are left alone.
-- ---------------------------------------------------------------------
insert into public.rrt_teams
  (code, name, mobile, vehicle_plate, vehicle_model, region,
   is_simulated, is_active, home_lat, home_lng)
values
  ('RRT-01', 'Alpha Team',    '+91 98100 00001', 'HR 26 CA 1001', 'Mahindra Bolero',     'MG Road',           false, true, 28.468500, 77.069000),
  ('RRT-02', 'Bravo Team',    '+91 98100 00002', 'HR 26 CA 1002', 'Maruti Suzuki Ertiga','Cyber City',        true,  true, 28.495500, 77.088500),
  ('RRT-03', 'Charlie Team',  '+91 98100 00003', 'HR 26 CA 1003', 'Mahindra Bolero',     'Golf Course Road',  true,  true, 28.444000, 77.101000),
  ('RRT-04', 'Delta Team',    '+91 98100 00004', 'HR 26 CA 1004', 'Tata Sumo',           'Sohna Road',        true,  true, 28.415000, 77.044000),
  ('RRT-05', 'Echo Team',     '+91 98100 00005', 'HR 26 CA 1005', 'Maruti Suzuki Ertiga','Udyog Vihar',       true,  true, 28.502000, 77.085000),
  ('RRT-06', 'Foxtrot Team',  '+91 98100 00006', 'HR 26 CA 1006', 'Mahindra Bolero',     'Palam Vihar',       true,  true, 28.506000, 77.030000),
  ('RRT-07', 'Golf Team',     '+91 98100 00007', 'HR 26 CA 1007', 'Tata Sumo',           'Old Gurugram',      true,  true, 28.459000, 77.023000),
  ('RRT-08', 'Hotel Team',    '+91 98100 00008', 'HR 26 CA 1008', 'Maruti Suzuki Ertiga','Golf Course Road',  true,  true, 28.426000, 77.107000),
  ('RRT-09', 'India Team',    '+91 98100 00009', 'HR 26 CA 1009', 'Mahindra Bolero',     'Manesar',           true,  true, 28.360000, 76.945000),
  ('RRT-10', 'Juliet Team',   '+91 98100 00010', 'HR 26 CA 1010', 'Tata Sumo',           'Dwarka Expressway', true,  true, 28.403000, 76.995000)
on conflict (code) do update
  set name          = excluded.name,
      mobile        = excluded.mobile,
      vehicle_plate = excluded.vehicle_plate,
      vehicle_model = excluded.vehicle_model,
      region        = excluded.region,
      home_lat      = excluded.home_lat,
      home_lng      = excluded.home_lng;

-- Bring the simulated teams online at their base (first run only: teams that
-- have never reported a position).
update public.rrt_teams
   set is_online_enabled = true,
       last_lat      = home_lat,
       last_lng      = home_lng,
       last_speed_kmh = 0,
       last_accuracy_m = 5,
       last_seen_at  = now(),
       status        = 'AVAILABLE'
 where is_simulated
   and is_active
   and last_seen_at is null;

-- <<<<<<<<<< END seed_01_towers_and_teams.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN seed_02_users.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/seed/seed_02_users.sql
-- PERS Telecom Security - Phase 1 seed 2 of 3: demo login accounts
--
-- Creates one login per person and one login per RRT team:
--
--   adbhutremedy@gmail.com   Super Admin      (you)
--   admin@pers.example       Administrator
--   operator1@pers.example   Operator
--   operator2@pers.example   Operator
--   rrt01@pers.example ... rrt10@pers.example   one per RRT team
--
-- Every account gets the SAME demo password (below). CHANGE IT after the
-- demo: Supabase dashboard > Authentication > Users.
--
-- How it works
--   1. For each account: if no Supabase Auth user with that e-mail exists,
--      this script creates it (e-mail already confirmed).
--   2. Then it creates the matching profile row in public.users.
-- If step 1 is refused on your project (this does not normally happen) the
-- script prints a NOTICE. In that case create the users by hand in
-- Authentication > Users > Add user (tick "Auto Confirm User"), using the
-- e-mails above, and run this file again: it only fills in what is missing.
-- Safe to run more than once.
-- =====================================================================

select set_config('pers.skip_audit', 'on', true);

do $$
declare
  c_password constant text := 'PersDemo@2026';    -- <-- demo password for every account
  a record;
  v_uid uuid;
  v_role_id smallint;
  v_team uuid;
  v_hash text;
  v_col text;
begin
  v_hash := extensions.crypt(c_password, extensions.gen_salt('bf'));

  for a in
    select * from (values
      ('adbhutremedy@gmail.com', 'Bimad',              'SUPER_ADMIN', null,     '+91 98100 10001'),
      ('admin@pers.example',     'Demo Administrator', 'ADMIN',       null,     '+91 98100 10002'),
      ('operator1@pers.example', 'Control Room Operator 1', 'OPERATOR', null,   '+91 98100 10003'),
      ('operator2@pers.example', 'Control Room Operator 2', 'OPERATOR', null,   '+91 98100 10004'),
      ('rrt01@pers.example', 'Alpha Team Member',   'RRT_MEMBER', 'RRT-01', '+91 98100 00001'),
      ('rrt02@pers.example', 'Bravo Team Member',   'RRT_MEMBER', 'RRT-02', '+91 98100 00002'),
      ('rrt03@pers.example', 'Charlie Team Member', 'RRT_MEMBER', 'RRT-03', '+91 98100 00003'),
      ('rrt04@pers.example', 'Delta Team Member',   'RRT_MEMBER', 'RRT-04', '+91 98100 00004'),
      ('rrt05@pers.example', 'Echo Team Member',    'RRT_MEMBER', 'RRT-05', '+91 98100 00005'),
      ('rrt06@pers.example', 'Foxtrot Team Member', 'RRT_MEMBER', 'RRT-06', '+91 98100 00006'),
      ('rrt07@pers.example', 'Golf Team Member',    'RRT_MEMBER', 'RRT-07', '+91 98100 00007'),
      ('rrt08@pers.example', 'Hotel Team Member',   'RRT_MEMBER', 'RRT-08', '+91 98100 00008'),
      ('rrt09@pers.example', 'India Team Member',   'RRT_MEMBER', 'RRT-09', '+91 98100 00009'),
      ('rrt10@pers.example', 'Juliet Team Member',  'RRT_MEMBER', 'RRT-10', '+91 98100 00010')
    ) as t(email, full_name, role_code, team_code, phone)
  loop
    -- 1. Supabase Auth account ------------------------------------------
    select u.id into v_uid from auth.users u where lower(u.email) = a.email;

    if v_uid is null then
      begin
        v_uid := gen_random_uuid();

        insert into auth.users
          (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values
          ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
           a.email, v_hash, now(),
           '{"provider": "email", "providers": ["email"]}'::jsonb,
           jsonb_build_object('full_name', a.full_name),
           now(), now());

        -- GoTrue cannot read rows where these text columns are NULL.
        foreach v_col in array array['confirmation_token', 'recovery_token', 'email_change_token_new',
                                     'email_change', 'email_change_token_current',
                                     'phone_change', 'phone_change_token', 'reauthentication_token']
        loop
          if exists (select 1 from information_schema.columns
                      where table_schema = 'auth' and table_name = 'users' and column_name = v_col) then
            execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', v_col, v_col) using v_uid;
          end if;
        end loop;

        -- Identity row: required for e-mail + password sign-in.
        if exists (select 1 from information_schema.columns
                    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
          insert into auth.identities
            (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
          values
            (gen_random_uuid(), v_uid::text, v_uid,
             jsonb_build_object('sub', v_uid::text, 'email', a.email,
                                'email_verified', true, 'phone_verified', false),
             'email', now(), now(), now());
        else
          insert into auth.identities
            (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
          values
            (v_uid::text, v_uid,
             jsonb_build_object('sub', v_uid::text, 'email', a.email),
             'email', now(), now(), now());
        end if;
      exception when others then
        v_uid := null;
        raise notice 'Could not create the login for % automatically (%). Create it in Authentication > Users, then run this file again.', a.email, sqlerrm;
      end;
    end if;

    -- 2. Profile row ------------------------------------------------------
    if v_uid is not null then
      select r.id into v_role_id from public.roles r where r.code = a.role_code::public.role_code;
      select t.id into v_team from public.rrt_teams t where t.code = a.team_code;

      insert into public.users (id, email, full_name, phone, role_id, rrt_team_id, is_active)
      values (v_uid, a.email, a.full_name, a.phone, v_role_id, v_team, true)
      on conflict (id) do update
        set email       = excluded.email,
            full_name   = excluded.full_name,
            phone       = excluded.phone,
            role_id     = excluded.role_id,
            rrt_team_id = excluded.rrt_team_id,
            is_active   = true;
    end if;
  end loop;
end
$$;

-- <<<<<<<<<< END seed_02_users.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN seed_03_demo_history.sql >>>>>>>>>>
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

-- <<<<<<<<<< END seed_03_demo_history.sql <<<<<<<<<<

-- >>>>>>>>>> BEGIN seed_04_more_towers.sql >>>>>>>>>>
-- =====================================================================
-- FILE: supabase/seed/seed_04_more_towers.sql
-- PERS Telecom Security - Phase 2 seed: 70 more demo towers (GGN-031 .. GGN-100)
--
-- Phase 1 created 30 towers; the project brief asks for 100. This file adds
-- the remaining 70, spread over Gurugram localities. Coordinates are
-- realistic for each area but are demo data, not real operator sites.
-- Run AFTER seed_01. Safe to run more than once (existing rows are updated).
-- =====================================================================

select set_config('pers.skip_audit', 'on', true);

insert into public.towers (tower_number, site_name, lat, lng, region, status, address)
values
  ('GGN-031', 'Sector 15 Part 2 - Site 1', 28.467334, 77.036018, 'Old Gurugram', 'ACTIVE', 'Sector 15 Part 2 - Site 1, Gurugram'),
  ('GGN-032', 'Sector 15 Part 2 - Site 2', 28.470083, 77.038520, 'Old Gurugram', 'ACTIVE', 'Sector 15 Part 2 - Site 2, Gurugram'),
  ('GGN-033', 'Sector 15 Part 2 - Site 3', 28.467218, 77.034063, 'Old Gurugram', 'ACTIVE', 'Sector 15 Part 2 - Site 3, Gurugram'),
  ('GGN-034', 'Sector 31 - Site 1', 28.456707, 77.048396, 'Old Gurugram', 'ACTIVE', 'Sector 31 - Site 1, Gurugram'),
  ('GGN-035', 'Sector 31 - Site 2', 28.457984, 77.048335, 'Old Gurugram', 'ACTIVE', 'Sector 31 - Site 2, Gurugram'),
  ('GGN-036', 'Sector 31 - Site 3', 28.457614, 77.049877, 'Old Gurugram', 'ACTIVE', 'Sector 31 - Site 3, Gurugram'),
  ('GGN-037', 'Sector 40 - Site 1', 28.449757, 77.055606, 'Old Gurugram', 'ACTIVE', 'Sector 40 - Site 1, Gurugram'),
  ('GGN-038', 'Sector 40 - Site 2', 28.446180, 77.055799, 'Old Gurugram', 'ACTIVE', 'Sector 40 - Site 2, Gurugram'),
  ('GGN-039', 'Sector 40 - Site 3', 28.445275, 77.057217, 'Old Gurugram', 'ACTIVE', 'Sector 40 - Site 3, Gurugram'),
  ('GGN-040', 'Sector 21 Dwarka Link - Site 1', 28.499648, 77.017203, 'Palam Vihar', 'ACTIVE', 'Sector 21 Dwarka Link - Site 1, Gurugram'),
  ('GGN-041', 'Sector 21 Dwarka Link - Site 2', 28.501296, 77.016256, 'Palam Vihar', 'ACTIVE', 'Sector 21 Dwarka Link - Site 2, Gurugram'),
  ('GGN-042', 'Sector 21 Dwarka Link - Site 3', 28.497972, 77.013261, 'Palam Vihar', 'ACTIVE', 'Sector 21 Dwarka Link - Site 3, Gurugram'),
  ('GGN-043', 'Sector 9A - Site 1', 28.482359, 77.024005, 'Old Gurugram', 'ACTIVE', 'Sector 9A - Site 1, Gurugram'),
  ('GGN-044', 'Sector 9A - Site 2', 28.481136, 77.024498, 'Old Gurugram', 'ACTIVE', 'Sector 9A - Site 2, Gurugram'),
  ('GGN-045', 'Sector 9A - Site 3', 28.479095, 77.018034, 'Old Gurugram', 'ACTIVE', 'Sector 9A - Site 3, Gurugram'),
  ('GGN-046', 'Sector 10A - Site 1', 28.487883, 77.030402, 'Old Gurugram', 'ACTIVE', 'Sector 10A - Site 1, Gurugram'),
  ('GGN-047', 'Sector 10A - Site 2', 28.487545, 77.029702, 'Old Gurugram', 'MAINTENANCE', 'Sector 10A - Site 2, Gurugram'),
  ('GGN-048', 'Sector 10A - Site 3', 28.491635, 77.031428, 'Old Gurugram', 'ACTIVE', 'Sector 10A - Site 3, Gurugram'),
  ('GGN-049', 'Sector 18 Udyog Vihar - Site 1', 28.495542, 77.064673, 'Udyog Vihar', 'ACTIVE', 'Sector 18 Udyog Vihar - Site 1, Gurugram'),
  ('GGN-050', 'Sector 18 Udyog Vihar - Site 2', 28.496476, 77.067045, 'Udyog Vihar', 'ACTIVE', 'Sector 18 Udyog Vihar - Site 2, Gurugram'),
  ('GGN-051', 'Sector 18 Udyog Vihar - Site 3', 28.494456, 77.067291, 'Udyog Vihar', 'ACTIVE', 'Sector 18 Udyog Vihar - Site 3, Gurugram'),
  ('GGN-052', 'Sector 18 Udyog Vihar - Site 4', 28.495600, 77.067989, 'Udyog Vihar', 'ACTIVE', 'Sector 18 Udyog Vihar - Site 4, Gurugram'),
  ('GGN-053', 'Sector 17 Udyog Vihar - Site 1', 28.503315, 77.075045, 'Udyog Vihar', 'ACTIVE', 'Sector 17 Udyog Vihar - Site 1, Gurugram'),
  ('GGN-054', 'Sector 17 Udyog Vihar - Site 2', 28.507751, 77.075701, 'Udyog Vihar', 'ACTIVE', 'Sector 17 Udyog Vihar - Site 2, Gurugram'),
  ('GGN-055', 'Sector 17 Udyog Vihar - Site 3', 28.505937, 77.077917, 'Udyog Vihar', 'ACTIVE', 'Sector 17 Udyog Vihar - Site 3, Gurugram'),
  ('GGN-056', 'DLF Phase 1 - Site 1', 28.473311, 77.097440, 'Cyber City', 'ACTIVE', 'DLF Phase 1 - Site 1, Gurugram'),
  ('GGN-057', 'DLF Phase 1 - Site 2', 28.477984, 77.097854, 'Cyber City', 'ACTIVE', 'DLF Phase 1 - Site 2, Gurugram'),
  ('GGN-058', 'DLF Phase 1 - Site 3', 28.475126, 77.094678, 'Cyber City', 'ACTIVE', 'DLF Phase 1 - Site 3, Gurugram'),
  ('GGN-059', 'DLF Phase 1 - Site 4', 28.473072, 77.095403, 'Cyber City', 'ACTIVE', 'DLF Phase 1 - Site 4, Gurugram'),
  ('GGN-060', 'DLF Phase 2 - Site 1', 28.486842, 77.091433, 'Cyber City', 'ACTIVE', 'DLF Phase 2 - Site 1, Gurugram'),
  ('GGN-061', 'DLF Phase 2 - Site 2', 28.492708, 77.087218, 'Cyber City', 'ACTIVE', 'DLF Phase 2 - Site 2, Gurugram'),
  ('GGN-062', 'DLF Phase 2 - Site 3', 28.490856, 77.089790, 'Cyber City', 'ACTIVE', 'DLF Phase 2 - Site 3, Gurugram'),
  ('GGN-063', 'DLF Phase 4 - Site 1', 28.462875, 77.088102, 'Golf Course Road', 'ACTIVE', 'DLF Phase 4 - Site 1, Gurugram'),
  ('GGN-064', 'DLF Phase 4 - Site 2', 28.465701, 77.090887, 'Golf Course Road', 'ACTIVE', 'DLF Phase 4 - Site 2, Gurugram'),
  ('GGN-065', 'DLF Phase 4 - Site 3', 28.462698, 77.089786, 'Golf Course Road', 'ACTIVE', 'DLF Phase 4 - Site 3, Gurugram'),
  ('GGN-066', 'DLF Phase 4 - Site 4', 28.466006, 77.093411, 'Golf Course Road', 'ACTIVE', 'DLF Phase 4 - Site 4, Gurugram'),
  ('GGN-067', 'Sector 28 DLF - Site 1', 28.475319, 77.082419, 'Golf Course Road', 'ACTIVE', 'Sector 28 DLF - Site 1, Gurugram'),
  ('GGN-068', 'Sector 28 DLF - Site 2', 28.476188, 77.080653, 'Golf Course Road', 'ACTIVE', 'Sector 28 DLF - Site 2, Gurugram'),
  ('GGN-069', 'Sector 28 DLF - Site 3', 28.477099, 77.082013, 'Golf Course Road', 'ACTIVE', 'Sector 28 DLF - Site 3, Gurugram'),
  ('GGN-070', 'Sector 44 - Site 1', 28.449852, 77.080691, 'Golf Course Road', 'ACTIVE', 'Sector 44 - Site 1, Gurugram'),
  ('GGN-071', 'Sector 44 - Site 2', 28.449531, 77.076561, 'Golf Course Road', 'ACTIVE', 'Sector 44 - Site 2, Gurugram'),
  ('GGN-072', 'Sector 44 - Site 3', 28.448383, 77.074732, 'Golf Course Road', 'ACTIVE', 'Sector 44 - Site 3, Gurugram'),
  ('GGN-073', 'Sector 45 - Site 1', 28.441089, 77.070681, 'Golf Course Road', 'MAINTENANCE', 'Sector 45 - Site 1, Gurugram'),
  ('GGN-074', 'Sector 45 - Site 2', 28.439708, 77.070160, 'Golf Course Road', 'ACTIVE', 'Sector 45 - Site 2, Gurugram'),
  ('GGN-075', 'Sector 45 - Site 3', 28.439927, 77.072951, 'Golf Course Road', 'ACTIVE', 'Sector 45 - Site 3, Gurugram'),
  ('GGN-076', 'Sector 47 Sohna Road - Site 1', 28.428321, 77.047899, 'Sohna Road', 'ACTIVE', 'Sector 47 Sohna Road - Site 1, Gurugram'),
  ('GGN-077', 'Sector 47 Sohna Road - Site 2', 28.430079, 77.050283, 'Sohna Road', 'ACTIVE', 'Sector 47 Sohna Road - Site 2, Gurugram'),
  ('GGN-078', 'Sector 47 Sohna Road - Site 3', 28.432156, 77.048405, 'Sohna Road', 'ACTIVE', 'Sector 47 Sohna Road - Site 3, Gurugram'),
  ('GGN-079', 'Sector 48 Sohna Road - Site 1', 28.422851, 77.047320, 'Sohna Road', 'ACTIVE', 'Sector 48 Sohna Road - Site 1, Gurugram'),
  ('GGN-080', 'Sector 48 Sohna Road - Site 2', 28.418717, 77.047918, 'Sohna Road', 'ACTIVE', 'Sector 48 Sohna Road - Site 2, Gurugram'),
  ('GGN-081', 'Sector 48 Sohna Road - Site 3', 28.417189, 77.046325, 'Sohna Road', 'ACTIVE', 'Sector 48 Sohna Road - Site 3, Gurugram'),
  ('GGN-082', 'Sector 51 - Site 1', 28.416996, 77.060106, 'Sohna Road', 'ACTIVE', 'Sector 51 - Site 1, Gurugram'),
  ('GGN-083', 'Sector 51 - Site 2', 28.414670, 77.063257, 'Sohna Road', 'ACTIVE', 'Sector 51 - Site 2, Gurugram'),
  ('GGN-084', 'Sector 51 - Site 3', 28.418271, 77.062397, 'Sohna Road', 'ACTIVE', 'Sector 51 - Site 3, Gurugram'),
  ('GGN-085', 'Sector 52 Wazirabad - Site 1', 28.439854, 77.016950, 'Sohna Road', 'ACTIVE', 'Sector 52 Wazirabad - Site 1, Gurugram'),
  ('GGN-086', 'Sector 52 Wazirabad - Site 2', 28.438365, 77.019989, 'Sohna Road', 'ACTIVE', 'Sector 52 Wazirabad - Site 2, Gurugram'),
  ('GGN-087', 'Sector 52 Wazirabad - Site 3', 28.437177, 77.021733, 'Sohna Road', 'ACTIVE', 'Sector 52 Wazirabad - Site 3, Gurugram'),
  ('GGN-088', 'Sector 55 - Site 1', 28.429379, 77.099646, 'Golf Course Road', 'ACTIVE', 'Sector 55 - Site 1, Gurugram'),
  ('GGN-089', 'Sector 55 - Site 2', 28.426598, 77.096501, 'Golf Course Road', 'ACTIVE', 'Sector 55 - Site 2, Gurugram'),
  ('GGN-090', 'Sector 55 - Site 3', 28.430564, 77.103025, 'Golf Course Road', 'ACTIVE', 'Sector 55 - Site 3, Gurugram'),
  ('GGN-091', 'Sector 58 - Site 1', 28.402081, 77.102056, 'Golf Course Road', 'INACTIVE', 'Sector 58 - Site 1, Gurugram'),
  ('GGN-092', 'Sector 58 - Site 2', 28.403235, 77.100848, 'Golf Course Road', 'ACTIVE', 'Sector 58 - Site 2, Gurugram'),
  ('GGN-093', 'Sector 58 - Site 3', 28.406763, 77.103195, 'Golf Course Road', 'ACTIVE', 'Sector 58 - Site 3, Gurugram'),
  ('GGN-094', 'Sector 62 Golf Course Ext - Site 1', 28.406179, 77.090948, 'Golf Course Road', 'ACTIVE', 'Sector 62 Golf Course Ext - Site 1, Gurugram'),
  ('GGN-095', 'Sector 62 Golf Course Ext - Site 2', 28.402583, 77.088694, 'Golf Course Road', 'ACTIVE', 'Sector 62 Golf Course Ext - Site 2, Gurugram'),
  ('GGN-096', 'Sector 62 Golf Course Ext - Site 3', 28.405581, 77.091887, 'Golf Course Road', 'ACTIVE', 'Sector 62 Golf Course Ext - Site 3, Gurugram'),
  ('GGN-097', 'Sector 66 - Site 1', 28.401150, 77.077944, 'Golf Course Road', 'ACTIVE', 'Sector 66 - Site 1, Gurugram'),
  ('GGN-098', 'Sector 66 - Site 2', 28.399543, 77.075444, 'Golf Course Road', 'ACTIVE', 'Sector 66 - Site 2, Gurugram'),
  ('GGN-099', 'Sector 66 - Site 3', 28.396060, 77.078616, 'Golf Course Road', 'ACTIVE', 'Sector 66 - Site 3, Gurugram'),
  ('GGN-100', 'Sector 70 - Site 1', 28.391208, 77.052632, 'Sohna Road', 'ACTIVE', 'Sector 70 - Site 1, Gurugram')
on conflict (tower_number) do update
  set site_name = excluded.site_name,
      lat       = excluded.lat,
      lng       = excluded.lng,
      region    = excluded.region,
      status    = excluded.status,
      address   = excluded.address,
      deleted_at = null;

-- <<<<<<<<<< END seed_04_more_towers.sql <<<<<<<<<<

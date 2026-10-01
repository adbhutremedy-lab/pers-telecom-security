-- =====================================================================
-- FILE: supabase/tests/phase1_dispatch_test.sql
-- PERS Telecom Security - Phase 1 acceptance test (the "does it really
-- work" test)
--
-- Plays a complete incident through the real database functions, acting as
-- the real demo users (operator, RRT members, administrator, anonymous):
--   trigger -> nearest team -> time-out -> reject -> accept -> GPS ->
--   automatic arrival -> resolution form -> escalation when nobody is
--   free -> cancel -> reassign -> security checks.
--
-- Run it AFTER all migrations and the three seed files, in the Supabase
-- SQL Editor. It shows ONE table at the end: every row must say PASS.
-- At the end it calls reset_demo(), so the test incidents disappear and the
-- demo is back to its seeded state (history is kept).
-- =====================================================================

create temp table if not exists _t (n serial primary key, test text, ok boolean, detail text);
truncate _t;

create or replace function pg_temp.chk(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into _t (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail)
$$;

create or replace function pg_temp.claims(p_uid uuid)
returns text language sql as $$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aud', 'authenticated')::text
$$;

do $$
declare
  v_op     uuid;  v_admin uuid;
  v_towerA uuid;  v_towerB uuid;  v_towerC uuid;
  v_ta     public.towers%rowtype;
  v_exp1   uuid;                       -- expected nearest team
  v_res    jsonb; v_err text;
  v_inc    uuid;  v_inc2 uuid; v_inc3 uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid;     -- teams offered 1st, 2nd, 3rd
  v_u2 uuid; v_u3 uuid;                -- users of team 2 / 3
  v_other uuid;
  v_n integer;
  v_q6 uuid := 'f1000000-0000-4000-8000-000000000006';
  v_good jsonb;
  v_text text;
  v_i public.incidents%rowtype;
begin
  select id into v_op    from public.users where email = 'operator1@pers.example';
  select id into v_admin from public.users where email = 'admin@pers.example';
  if v_op is null or v_admin is null then
    raise exception 'Seed users are missing. Run seed_01, seed_02 and seed_03 first.';
  end if;

  select id into v_towerA from public.towers where tower_number = 'GGN-001';
  select id into v_towerB from public.towers where tower_number = 'GGN-006';
  select id into v_towerC from public.towers where tower_number = 'GGN-008';
  select * into v_ta from public.towers where id = v_towerA;

  -- make sure the world is clean and every simulated team is online and fresh
  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  perform public.reset_demo();
  reset role;

  select t.id into v_exp1
    from public.rrt_teams t
   where t.status = 'AVAILABLE' and t.is_active
   order by public.haversine_km(t.last_lat, t.last_lng, v_ta.lat, v_ta.lng) limit 1;

  -- 1. operator triggers an incident ----------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    v_res := public.trigger_incident(v_towerA);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('1.1 operator can trigger an incident', v_err is null, v_err);
  v_inc := (v_res ->> 'id')::uuid;
  perform pg_temp.chk('1.2 incident is OPEN with a number',
                      v_res ->> 'status' = 'OPEN' and (v_res ->> 'incident_number') like 'INC-%',
                      v_res ->> 'incident_number');

  select a.id, a.team_id into v_o1, v_t1
    from public.incident_assignments a where a.incident_id = v_inc and a.status = 'PENDING';
  perform pg_temp.chk('1.3 exactly one offer, to the NEAREST team',
                      v_o1 is not null and v_t1 = v_exp1,
                      (select code from public.rrt_teams where id = v_t1));
  select count(*) into v_n from public.notifications
   where incident_id = v_inc and type = 'INCIDENT_OFFER' and team_id = v_t1;
  perform pg_temp.chk('1.4 the team received an "Incident Alert" notification', v_n >= 1, v_n::text);

  -- 2. a second incident on the same tower is refused -----------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.trigger_incident(v_towerA);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('2.1 second incident on the same tower is refused',
                      v_err like 'TOWER_HAS_ACTIVE_INCIDENT%', v_err);

  -- 3. a different team cannot accept someone else's offer ------------
  select u.id into v_other from public.users u
   where u.rrt_team_id is not null and u.rrt_team_id <> v_t1
     and u.rrt_team_id in (select id from public.rrt_teams where is_simulated) limit 1;
  perform set_config('request.jwt.claims', pg_temp.claims(v_other), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.accept_offer(v_o1);
  exception when others then v_err := sqlerrm; end;
  select count(*) into v_n from public.incidents where id = v_inc;
  reset role;
  perform pg_temp.chk('3.1 another team cannot accept the offer', v_err like 'PERMISSION_DENIED%', v_err);
  perform pg_temp.chk('3.2 another team cannot even see the incident (RLS)', v_n = 0, v_n::text);

  -- 4. 30 seconds pass with no answer -> next nearest team ------------
  update public.incident_assignments set expires_at = now() - interval '1 second' where id = v_o1;
  perform app.process_expired_offers();
  perform pg_temp.chk('4.1 unanswered offer becomes EXPIRED',
                      (select status::text from public.incident_assignments where id = v_o1) = 'EXPIRED');
  select a.id, a.team_id into v_o2, v_t2
    from public.incident_assignments a where a.incident_id = v_inc and a.status = 'PENDING';
  perform pg_temp.chk('4.2 a NEW offer goes to a different team, sequence 2',
                      v_o2 is not null and v_t2 <> v_t1
                      and (select sequence_no from public.incident_assignments where id = v_o2) = 2);

  -- 5. second team rejects -> third team -------------------------------
  select u.id into v_u2 from public.users u where u.rrt_team_id = v_t2 limit 1;
  perform set_config('request.jwt.claims', pg_temp.claims(v_u2), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.reject_offer(v_o2, 'Vehicle in service');
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('5.1 team can reject an offer', v_err is null, v_err);
  select a.id, a.team_id into v_o3, v_t3
    from public.incident_assignments a where a.incident_id = v_inc and a.status = 'PENDING';
  perform pg_temp.chk('5.2 offer moves to a third team',
                      v_o3 is not null and v_t3 not in (v_t1, v_t2));

  -- 6. third team accepts ---------------------------------------------
  select u.id into v_u3 from public.users u where u.rrt_team_id = v_t3 limit 1;
  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    v_res := public.accept_offer(v_o3);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('6.1 team accepts the offer', v_err is null, v_err);
  select * into v_i from public.incidents where id = v_inc;
  perform pg_temp.chk('6.2 incident is ASSIGNED to that team with accept time',
                      v_i.status = 'ASSIGNED' and v_i.assigned_team_id = v_t3 and v_i.accepted_at is not null
                      and v_i.accept_seconds is not null);
  perform pg_temp.chk('6.3 team status is ASSIGNED and linked to the incident',
                      (select status::text || '/' || coalesce(current_incident_id::text, '') from public.rrt_teams where id = v_t3)
                      = 'ASSIGNED/' || v_inc::text);
  perform pg_temp.chk('6.4 navigation link is returned',
                      (v_res ->> 'navigate_url') like 'https://www.google.com/maps/dir/%');

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.accept_offer(v_o3);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('6.5 accepting twice is refused', v_err like 'OFFER_NOT_PENDING%', v_err);

  -- 7. GPS: far away, inaccurate, then arrival -------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.post_location(v_ta.lat + 0.03, v_ta.lng, 30, 90, 8);
  exception when others then v_err := sqlerrm; end;
  reset role;
  select * into v_i from public.incidents where id = v_inc;
  perform pg_temp.chk('7.1 GPS far away: still ASSIGNED, distance and ETA updated',
                      v_err is null and v_i.status = 'ASSIGNED' and v_i.distance_remaining_m > 2500 and v_i.eta_seconds > 0,
                      coalesce(v_err, v_i.distance_remaining_m::text));

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  perform public.post_location(v_ta.lat + 0.00027, v_ta.lng, 0, 0, 150);       -- 30 m away but inaccurate (150 m)
  reset role;
  perform pg_temp.chk('7.2 inaccurate GPS (150 m) does NOT trigger arrival',
                      (select status::text from public.incidents where id = v_inc) = 'ASSIGNED');

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  perform public.post_location(v_ta.lat + 0.00027, v_ta.lng, 0, 0, 10);        -- 30 m away, accurate
  reset role;
  select * into v_i from public.incidents where id = v_inc;
  perform pg_temp.chk('7.3 within 50 m and accurate: incident becomes REACHED automatically',
                      v_i.status = 'REACHED' and v_i.reached_at is not null and not v_i.reached_manually
                      and v_i.travel_seconds is not null and v_i.response_seconds is not null);
  perform pg_temp.chk('7.4 team status is REACHED',
                      (select status::text from public.rrt_teams where id = v_t3) = 'REACHED');
  select count(*) into v_n from public.notifications
   where incident_id = v_inc and type = 'INCIDENT_REACHED' and user_id = v_op;
  perform pg_temp.chk('7.5 operator received "RRT reached" notification', v_n = 1, v_n::text);

  -- 8. resolution form -------------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.resolve_incident(v_inc, '[]'::jsonb);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('8.1 resolving with no answers is refused (required question)',
                      v_err like 'REQUIRED_QUESTION%', v_err);

  v_good := jsonb_build_array(
    jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000001', 'value', true),
    jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000002', 'value', 'Power failure'),
    jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000003', 'value', 'Generator started, site restored.'),
    jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000004', 'value', 4));

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.resolve_incident(v_inc, jsonb_build_array(
      jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000001', 'value', true),
      jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000002', 'value', 'Power failure'),
      jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000003', 'value', 'x'),
      jsonb_build_object('question_id', 'f1000000-0000-4000-8000-000000000004', 'value', 9)));
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('8.2 rating outside 1-5 is refused', v_err like 'INVALID_ANSWER%', v_err);

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.resolve_incident(v_inc, v_good);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('8.3 resolving without the required photo is refused',
                      v_err like 'REQUIRED_QUESTION%', v_err);

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    insert into public.incident_photos (incident_id, question_id, kind, storage_path, file_name, mime_type, uploaded_by)
    values (v_inc, v_q6, 'PHOTO', (select incident_number from public.incidents where id = v_inc) || '/test.jpg',
            'test.jpg', 'image/jpeg', v_u3);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('8.4 team member can attach a photo to its own incident', v_err is null, v_err);

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    v_res := public.resolve_incident(v_inc, v_good);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('8.5 valid form resolves the incident', v_err is null, v_err);
  select * into v_i from public.incidents where id = v_inc;
  perform pg_temp.chk('8.6 incident RESOLVED with all duration columns filled',
                      v_i.status = 'RESOLVED' and v_i.resolved_at is not null and v_i.accept_seconds is not null
                      and v_i.travel_seconds is not null and v_i.response_seconds is not null
                      and v_i.onsite_seconds is not null and v_i.resolution_seconds is not null);
  perform pg_temp.chk('8.7 team is free again',
                      (select current_incident_id is null and status::text = 'AVAILABLE' from public.rrt_teams where id = v_t3));
  select count(*) into v_n from public.incident_answers where incident_id = v_inc;
  perform pg_temp.chk('8.8 four answers were saved', v_n = 4, v_n::text);
  select count(*) into v_n from public.notifications
   where incident_id = v_inc and type = 'INCIDENT_RESOLVED' and user_id = v_op;
  perform pg_temp.chk('8.9 operator received "resolved" notification', v_n = 1, v_n::text);

  -- 9. nobody free -> EXHAUSTED -> a team comes online -> offered ------
  update public.rrt_teams set is_online_enabled = false, status = 'OFFLINE' where is_active;
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    v_res := public.trigger_incident(v_towerB);
  exception when others then v_err := sqlerrm; end;
  reset role;
  v_inc2 := (v_res ->> 'id')::uuid;
  select * into v_i from public.incidents where id = v_inc2;
  perform pg_temp.chk('9.1 with no team available the incident stays OPEN and is EXHAUSTED',
                      v_err is null and v_i.status = 'OPEN' and v_i.dispatch_state = 'EXHAUSTED',
                      coalesce(v_err, v_i.dispatch_state::text));
  select count(*) into v_n from public.notifications where incident_id = v_inc2 and type = 'INCIDENT_EXHAUSTED' and user_id = v_op;
  perform pg_temp.chk('9.2 operator is alerted that no team is available', v_n >= 1, v_n::text);

  update public.rrt_teams
     set is_online_enabled = true, last_seen_at = now(), status = 'AVAILABLE'
   where code = 'RRT-07';
  select a.team_id into v_t1 from public.incident_assignments a where a.incident_id = v_inc2 and a.status = 'PENDING';
  perform pg_temp.chk('9.3 a team coming online is offered the waiting incident immediately',
                      v_t1 = (select id from public.rrt_teams where code = 'RRT-07'));

  -- 10. operator cancels -----------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.cancel_incident(v_inc2, 'Test cancel');
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('10.1 operator can cancel', v_err is null, v_err);
  perform pg_temp.chk('10.2 incident CANCELLED and the open offer is cancelled too',
                      (select status::text from public.incidents where id = v_inc2) = 'CANCELLED'
                      and not exists (select 1 from public.incident_assignments where incident_id = v_inc2 and status = 'PENDING'));

  -- 11. administrator drives a SIMULATED team (Demo Controller) --------
  update public.rrt_teams
     set is_online_enabled = true, last_seen_at = now(), status = 'AVAILABLE'
   where is_simulated and is_active and current_incident_id is null;

  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_res := public.trigger_incident(v_towerC);
  reset role;
  v_inc3 := (v_res ->> 'id')::uuid;
  select a.id, a.team_id into v_o1, v_t1 from public.incident_assignments a where a.incident_id = v_inc3 and a.status = 'PENDING';

  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.accept_offer(v_o1);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('11.1 administrator can accept for a SIMULATED team', v_err is null, v_err);

  -- 12. operator reassigns ---------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    v_res := public.reassign_incident(v_inc3, null);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('12.1 operator can reassign an assigned incident', v_err is null, v_err);
  select a.team_id into v_t2 from public.incident_assignments a where a.incident_id = v_inc3 and a.status = 'PENDING';
  perform pg_temp.chk('12.2 the NEW offer goes to a different team (round 2)',
                      v_t2 is not null and v_t2 <> v_t1 and (select dispatch_round from public.incidents where id = v_inc3) = 2);
  perform pg_temp.chk('12.3 the first team is released',
                      (select current_incident_id is null from public.rrt_teams where id = v_t1));

  select a.id into v_o2 from public.incident_assignments a where a.incident_id = v_inc3 and a.status = 'PENDING';
  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  perform public.accept_offer(v_o2);
  reset role;
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.mark_reached(v_inc3);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('12.4 operator can mark arrival manually',
                      v_err is null and (select reached_manually and status::text = 'REACHED' from public.incidents where id = v_inc3), v_err);

  -- 13. security checks -------------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  update public.towers set site_name = 'HACKED' where id = v_towerA;
  get diagnostics v_n = row_count;
  reset role;
  perform pg_temp.chk('13.1 an operator cannot edit towers (admin only)', v_n = 0, v_n::text);

  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.reset_demo();
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('13.2 an operator cannot reset the demo', v_err like 'PERMISSION_DENIED%', v_err);

  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  v_err := null;
  begin
    update public.incidents set status = 'RESOLVED' where id = v_inc3;
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('13.3 nobody can change incident status by direct UPDATE', v_err is not null, v_err);

  set local role anon;
  v_err := null;
  begin
    perform count(*) from public.towers;
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('13.4 anonymous visitors cannot read towers', v_err is not null, v_err);

  set local role anon;
  v_err := null;
  begin
    perform public.trigger_incident(v_towerB);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('13.5 anonymous visitors cannot call functions', v_err is not null, v_err);

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  select count(*) into v_n from public.towers;
  reset role;
  perform pg_temp.chk('13.6 an RRT member sees only towers of its own incidents', v_n < 30, v_n::text);

  perform set_config('request.jwt.claims', pg_temp.claims(v_u3), true);
  set local role authenticated;
  v_err := null;
  begin
    insert into public.incidents (tower_id) values (v_towerB);
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('13.7 an RRT member cannot create incidents directly', v_err is not null, v_err);

  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  v_err := null;
  begin
    insert into public.towers (tower_number, site_name, lat, lng, region) values ('TEST-1', 'Test Tower', 28.45, 77.03, 'Test');
    delete from public.towers where tower_number = 'TEST-1';
  exception when others then v_err := sqlerrm; end;
  reset role;
  perform pg_temp.chk('13.8 an administrator can add and remove a tower', v_err is null, v_err);

  v_err := null;
  begin
    update public.incidents set status = 'OPEN' where id = v_inc;     -- RESOLVED -> OPEN
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('13.9 status machine blocks RESOLVED -> OPEN', v_err like 'ILLEGAL_STATUS_CHANGE%', v_err);

  -- 14. background jobs ---------------------------------------------------
  update public.rrt_teams set status = 'AVAILABLE', last_seen_at = now() - interval '5 minutes'
   where code = 'RRT-09';
  perform app.mark_offline_teams();
  perform pg_temp.chk('14.1 a team with no GPS for 5 minutes is marked OFFLINE',
                      (select status::text from public.rrt_teams where code = 'RRT-09') = 'OFFLINE');

  update public.rrt_teams set is_online_enabled = true, last_seen_at = null, status = 'OFFLINE' where code = 'RRT-09';
  perform app.simulated_heartbeat();
  perform pg_temp.chk('14.2 demo heartbeat brings an idle simulated team back online',
                      (select status::text from public.rrt_teams where code = 'RRT-09') = 'AVAILABLE');

  if to_regclass('cron.job') is not null then
    select count(*) into v_n from cron.job where jobname like 'pers_%';
    perform pg_temp.chk('14.3 pg_cron jobs are scheduled (6 expected)', v_n = 6, v_n::text);
  else
    perform pg_temp.chk('14.3 pg_cron jobs are scheduled (6 expected)', false, 'pg_cron is not enabled');
  end if;

  -- 15. read helpers --------------------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  select count(*) into v_n from public.search_towers('cyber');
  select (public.report_summary(now() - interval '30 days', now() + interval '1 day') ->> 'total')::int into v_i.dispatch_round;
  select count(*) into v_text from public.v_dashboard_stats;
  reset role;
  perform pg_temp.chk('15.1 tower search finds "cyber"', v_n >= 1, v_n::text);
  perform pg_temp.chk('15.2 report summary returns data', v_i.dispatch_round is not null, v_i.dispatch_round::text);
  perform pg_temp.chk('15.3 dashboard stats view returns one row for staff', v_text = '1', v_text);

  -- 16. clean up: put the demo back as it was seeded -------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  v_res := public.reset_demo();
  reset role;
  select count(*) into v_n from public.incidents where not is_demo_seed;
  perform pg_temp.chk('16.1 reset_demo removes every test incident (history kept)', v_n = 0, v_res::text);
  select count(*) into v_n from public.incidents where is_demo_seed;
  perform pg_temp.chk('16.2 seeded history is still there', v_n >= 54, v_n::text);
exception when others then
  reset role;
  perform pg_temp.chk('TEST SCRIPT CRASHED', false, sqlerrm);
end
$$;

select n,
       test,
       case when ok then 'PASS' else 'FAIL' end as result,
       detail
  from _t
 order by n;

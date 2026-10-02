-- =====================================================================
-- FILE: supabase/tests/phase5b_map_location_test.sql
-- Acceptance test for migration 0014 (demo location). Every row must say
-- PASS. It changes nothing permanently (everything is rolled back).
-- =====================================================================
create temp table if not exists _t5b (n serial primary key, test text, ok boolean, detail text);
truncate _t5b;
grant all on _t5b to public;
grant all on sequence _t5b_n_seq to public;
create or replace function pg_temp.chk(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t5b (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create or replace function pg_temp.claims(p_uid uuid)
returns text language sql as $$ select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aud', 'authenticated')::text $$;

do $$
declare
  v_super uuid; v_admin uuid; v_op uuid; v_err text; v_n int;
  v_before double precision; v_max double precision; v_min double precision;
begin
  select id into v_super from public.users where email = 'adbhutremedy@gmail.com';
  select id into v_admin from public.users where email = 'admin@pers.example';
  select id into v_op    from public.users where email = 'operator1@pers.example';
  select last_lat into v_before from public.rrt_teams where code = 'RRT-01';

  -- operator and admin cannot move the simulated teams or change settings
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  begin perform public.move_simulated_teams(6.5244, 3.3792); v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('operator cannot move simulated teams', v_err like 'PERMISSION_DENIED%', v_err);
  reset role;

  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  begin perform public.move_simulated_teams(6.5244, 3.3792); v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('administrator cannot move simulated teams (Super Admin only)', v_err like 'PERMISSION_DENIED%', v_err);
  reset role;

  -- super admin can
  perform set_config('request.jwt.claims', pg_temp.claims(v_super), true);
  set local role authenticated;
  v_n := public.move_simulated_teams(6.5244, 3.3792);
  perform pg_temp.chk('super admin moves the simulated teams', v_n = 9, 'moved ' || v_n);
  reset role;

  select count(*), max(public.haversine_km(last_lat, last_lng, 6.5244, 3.3792)), min(public.haversine_km(last_lat, last_lng, 6.5244, 3.3792))
    into v_n, v_max, v_min
    from public.rrt_teams where is_simulated and is_active and abs(home_lat - last_lat) < 1e-9;
  perform pg_temp.chk('all 9 are 2-5.5 km from the new centre and base = live position', v_n = 9 and v_max between 3 and 5.5 and v_min >= 1.9, round(v_min::numeric,1) || '-' || round(v_max::numeric,1));
  perform pg_temp.chk('the real phone team is not moved', (select last_lat is not distinct from v_before from public.rrt_teams where code = 'RRT-01'));

  -- bad coordinates refused
  perform set_config('request.jwt.claims', pg_temp.claims(v_super), true);
  set local role authenticated;
  begin perform public.move_simulated_teams(120, 0); v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('latitude 120 is refused', v_err like 'INVALID_LOCATION%', v_err);

  -- settings: valid centre saved, bad ones refused
  update public.settings set value = '{"lat": 5.6037, "lng": -0.1870}'::jsonb where key = 'map_default_center';
  perform pg_temp.chk('Accra centre can be saved', (select (value ->> 'lat')::numeric = 5.6037 from public.settings where key = 'map_default_center'));
  begin update public.settings set value = '{"lat": 95, "lng": 0}'::jsonb where key = 'map_default_center'; v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('centre with latitude 95 is refused', v_err like 'INVALID_SETTING%', v_err);
  begin update public.settings set value = '"x"'::jsonb where key = 'map_default_center'; v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('centre that is not an object is refused', v_err like 'INVALID_SETTING%', v_err);
  begin update public.settings set value = '25'::jsonb where key = 'map_default_zoom'; v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('zoom 25 is refused', v_err like 'INVALID_SETTING%', v_err);
  begin update public.settings set value = '"  "'::jsonb where key = 'demo_city'; v_err := null; exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('empty city name is refused', v_err like 'INVALID_SETTING%', v_err);
  update public.settings set value = '"Accra, Ghana"'::jsonb where key = 'demo_city';
  perform pg_temp.chk('city name can be saved', (select value #>> '{}' = 'Accra, Ghana' from public.settings where key = 'demo_city'));
  reset role;

  -- put everything back
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.settings set value = '{"lat": 28.4595, "lng": 77.0266}'::jsonb where key = 'map_default_center';
  update public.settings set value = '"Gurugram, Haryana, India"'::jsonb where key = 'demo_city';
  perform public.move_simulated_teams(28.4595, 77.0266);
end $$;

select n, test, case when ok then 'PASS' else 'FAIL' end as result, detail from _t5b order by n;

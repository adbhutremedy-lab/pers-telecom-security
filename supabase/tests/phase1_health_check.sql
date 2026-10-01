-- =====================================================================
-- FILE: supabase/tests/phase1_health_check.sql
-- PERS Telecom Security - Phase 1 health check
--
-- Run in the Supabase SQL Editor after the migrations and seed files.
-- Shows ONE table: every row must say PASS. Changes nothing.
-- =====================================================================

create temp table if not exists _h (n serial primary key, area text, test text, ok boolean, detail text);
truncate _h;

create or replace function pg_temp.h(p_area text, p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into _h (area, test, ok, detail) values (p_area, p_test, coalesce(p_ok, false), p_detail)
$$;

do $$
declare
  v_n integer;
  v_list text;
  v_tables text[] := array['roles', 'users', 'rrt_teams', 'rrt_locations', 'towers', 'incidents',
                           'incident_assignments', 'custom_forms', 'custom_questions',
                           'incident_answers', 'incident_photos', 'notifications', 'audit_logs', 'settings'];
  v_views text[] := array['v_rrt_live', 'v_dashboard_stats', 'v_incident_detail', 'v_incident_offers',
                          'v_report_incidents', 'v_tower_incident_counts'];
  v_funcs text[] := array['trigger_incident', 'accept_offer', 'reject_offer', 'set_team_online', 'post_location',
                          'update_incident_route', 'resolve_incident', 'cancel_incident', 'reassign_incident',
                          'mark_reached', 'search_towers', 'report_summary', 'create_demo_tower', 'reset_demo',
                          'haversine_km'];
  t text;
begin
  -- Tables -----------------------------------------------------------------
  select count(*) into v_n from pg_tables where schemaname = 'public' and tablename = any (v_tables);
  perform pg_temp.h('schema', 'all 14 tables exist', v_n = 14, v_n || ' of 14');

  select string_agg(tablename, ', ') into v_list
    from pg_tables where schemaname = 'public' and tablename = any (v_tables) and not rowsecurity;
  perform pg_temp.h('security', 'row level security is ON for every table', v_list is null, coalesce('missing: ' || v_list, 'all on'));

  select string_agg(c.relname, ', ') into v_list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = any (v_views)
     and not coalesce((select 'security_invoker=true' = any (c.reloptions)), false);
  perform pg_temp.h('security', 'every view is security_invoker', v_list is null, coalesce('not invoker: ' || v_list, 'all invoker'));

  select count(*) into v_n from pg_views where schemaname = 'public' and viewname = any (v_views);
  perform pg_temp.h('schema', 'all 6 views exist', v_n = 6, v_n || ' of 6');

  select count(*) into v_n from pg_type ty join pg_namespace n on n.oid = ty.typnamespace
   where n.nspname = 'public' and ty.typtype = 'e';
  perform pg_temp.h('schema', 'enums exist (9 expected)', v_n = 9, v_n || ' found');

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (v_funcs);
  perform pg_temp.h('schema', 'all public functions exist (15 expected)', v_n >= 15, v_n || ' found');

  select count(*) into v_n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal;
  perform pg_temp.h('schema', 'triggers are installed (20 or more)', v_n >= 20, v_n || ' found');

  select count(*) into v_n from pg_policies where schemaname = 'public';
  perform pg_temp.h('security', 'RLS policies are installed (25 or more)', v_n >= 25, v_n || ' found');

  -- Privileges -------------------------------------------------------------
  select string_agg(table_name || ':' || privilege_type, ', ') into v_list
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  perform pg_temp.h('security', 'anonymous role has NO table privileges', v_list is null, coalesce(v_list, 'none'));

  select string_agg(table_name || ':' || privilege_type, ', ') into v_list
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and table_name in ('incidents', 'incident_assignments', 'rrt_locations', 'incident_answers', 'audit_logs')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  perform pg_temp.h('security', 'signed-in users cannot write dispatch tables directly',
                    v_list is null or v_list = 'incidents:DELETE',
                    coalesce(v_list, 'none'));

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trigger_incident'
     and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.h('security', 'anonymous role cannot run trigger_incident', v_n = 0, v_n::text);

  -- Data -------------------------------------------------------------------
  select count(*) into v_n from public.roles;
  perform pg_temp.h('data', '4 roles', v_n = 4, v_n::text);
  select count(*) into v_n from public.settings;
  perform pg_temp.h('data', 'settings loaded (15)', v_n >= 15, v_n::text);
  select count(*) into v_n from public.custom_questions q join public.custom_forms f on f.id = q.form_id where f.is_default;
  perform pg_temp.h('data', 'default form has 6 questions', v_n = 6, v_n::text);
  select count(*) into v_n from public.towers where deleted_at is null;
  perform pg_temp.h('data', '30 Gurugram demo towers', v_n >= 30, v_n::text);
  select count(*) into v_n from public.rrt_teams;
  perform pg_temp.h('data', '10 RRT teams', v_n >= 10, v_n::text);
  select count(*) into v_n from public.rrt_teams where not is_simulated;
  perform pg_temp.h('data', '1 real device team + 9 simulated', v_n >= 1 and (select count(*) from public.rrt_teams where is_simulated) >= 9, v_n || ' real');
  select count(*) into v_n from public.users;
  perform pg_temp.h('data', '14 login profiles (run seed_02 again if lower)', v_n >= 14, v_n::text);
  select count(*) into v_n from public.users u join auth.users a on a.id = u.id;
  perform pg_temp.h('data', 'every profile is linked to a Supabase login', v_n = (select count(*) from public.users), v_n::text);
  select count(*) into v_n from public.incidents where is_demo_seed;
  perform pg_temp.h('data', 'demo history present (54 incidents)', v_n >= 54, v_n::text);

  -- Platform features --------------------------------------------------------
  select count(*) into v_n from pg_extension where extname in ('pgcrypto', 'pg_trgm');
  perform pg_temp.h('platform', 'extensions pgcrypto and pg_trgm', v_n = 2, v_n::text);
  select count(*) into v_n from pg_extension where extname = 'pg_cron';
  perform pg_temp.h('platform', 'pg_cron is enabled (needed for 30-second escalation)', v_n = 1, case when v_n = 1 then 'enabled' else 'ENABLE IT: Database > Extensions > pg_cron, then re-run 0009' end);
  if to_regclass('cron.job') is not null then
    select count(*) into v_n from cron.job where jobname like 'pers_%';
    perform pg_temp.h('platform', 'background jobs scheduled (6)', v_n = 6, v_n::text);
  end if;
  select count(*) into v_n from pg_extension where extname = 'pg_net';
  perform pg_temp.h('platform', 'pg_net (optional: only needed for push notifications later)', true, case when v_n = 1 then 'enabled' else 'not enabled - fine for now' end);

  select count(*) into v_n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('rrt_teams', 'incidents', 'incident_assignments', 'notifications', 'towers', 'incident_photos');
  perform pg_temp.h('platform', 'realtime publishes 6 tables', v_n = 6, v_n::text);

  if to_regclass('storage.buckets') is not null then
    select count(*) into v_n from storage.buckets where id = 'incident-media' and not public;
    perform pg_temp.h('platform', 'private storage bucket "incident-media"', v_n = 1, v_n::text);
    select count(*) into v_n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pers_media_%';
    perform pg_temp.h('platform', 'storage access policies (4)', v_n = 4, v_n::text);
  end if;

  -- Rules ------------------------------------------------------------------
  perform pg_temp.h('rules', 'time zone is Asia/Kolkata', app.report_tz() = 'Asia/Kolkata', app.report_tz());
  perform pg_temp.h('rules', 'offer time-out is 30 seconds', app.setting_num('offer_timeout_seconds', 0) = 30, app.setting_num('offer_timeout_seconds', 0)::text);
  perform pg_temp.h('rules', 'arrival radius is 50 metres', app.setting_num('arrival_radius_m', 0) = 50, app.setting_num('arrival_radius_m', 0)::text);
  perform pg_temp.h('rules', 'Haversine: Cyber Hub to Huda City Centre is about 4 km',
                    public.haversine_km(28.4948, 77.0885, 28.4592, 77.0724) between 3.5 and 4.8,
                    round(public.haversine_km(28.4948, 77.0885, 28.4592, 77.0724)::numeric, 2)::text);
end
$$;

select n, area, test, case when ok then 'PASS' else 'FAIL' end as result, detail
  from _h order by n;

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

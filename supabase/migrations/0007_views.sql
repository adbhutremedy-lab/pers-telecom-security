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

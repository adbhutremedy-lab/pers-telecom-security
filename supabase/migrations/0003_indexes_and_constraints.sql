-- =====================================================================
-- FILE: supabase/migrations/0003_indexes_and_constraints.sql
-- PERS Telecom Security - Phase 1 / Step 3 of 10: indexes
-- Safe to run more than once (idempotent).
-- =====================================================================

-- ---- users ----------------------------------------------------------
create index if not exists idx_users_role_id     on public.users (role_id);
create index if not exists idx_users_rrt_team_id on public.users (rrt_team_id) where rrt_team_id is not null;
create unique index if not exists uq_users_email on public.users (lower(email)) where email is not null;

-- ---- rrt_teams ------------------------------------------------------
create index if not exists idx_rrt_teams_status       on public.rrt_teams (status);
create index if not exists idx_rrt_teams_last_seen_at on public.rrt_teams (last_seen_at desc);
create index if not exists idx_rrt_teams_active       on public.rrt_teams (is_active) where is_active;
create index if not exists idx_rrt_teams_current_inc  on public.rrt_teams (current_incident_id) where current_incident_id is not null;

-- ---- towers ---------------------------------------------------------
create index if not exists idx_towers_region on public.towers (region) where deleted_at is null;
create index if not exists idx_towers_status on public.towers (status) where deleted_at is null;
-- Type-ahead search (Incident > Create Incident > Search Tower Number)
create index if not exists idx_towers_number_trgm on public.towers using gin (tower_number extensions.gin_trgm_ops);
create index if not exists idx_towers_name_trgm   on public.towers using gin (site_name extensions.gin_trgm_ops);

-- ---- incidents ------------------------------------------------------
create index if not exists idx_incidents_status_triggered on public.incidents (status, triggered_at desc);
create index if not exists idx_incidents_tower            on public.incidents (tower_id, triggered_at desc);
create index if not exists idx_incidents_team             on public.incidents (assigned_team_id) where assigned_team_id is not null;
create index if not exists idx_incidents_region_triggered on public.incidents (region, triggered_at desc);
create index if not exists idx_incidents_triggered_at     on public.incidents (triggered_at desc);
create index if not exists idx_incidents_resolved_at      on public.incidents (resolved_at desc) where resolved_at is not null;
create index if not exists idx_incidents_waiting          on public.incidents (triggered_at)
  where status = 'OPEN' and dispatch_state = 'EXHAUSTED';
-- A tower can have only ONE live incident at a time (prevents double dispatch).
create unique index if not exists uq_incidents_one_active_per_tower
  on public.incidents (tower_id) where status in ('OPEN', 'ASSIGNED', 'REACHED');

-- ---- incident_assignments --------------------------------------------
create index if not exists idx_assignments_incident_status on public.incident_assignments (incident_id, status);
create index if not exists idx_assignments_team_status     on public.incident_assignments (team_id, status);
-- The 5-second sweep reads only this tiny partial index.
create index if not exists idx_assignments_pending_expiry  on public.incident_assignments (expires_at) where status = 'PENDING';
-- Exactly one open offer per incident, and one open offer per team.
create unique index if not exists uq_assignments_one_pending_per_incident
  on public.incident_assignments (incident_id) where status = 'PENDING';
create unique index if not exists uq_assignments_one_pending_per_team
  on public.incident_assignments (team_id) where status = 'PENDING';

-- ---- rrt_locations ---------------------------------------------------
create index if not exists idx_locations_team_received     on public.rrt_locations (team_id, received_at desc);
create index if not exists idx_locations_incident_received on public.rrt_locations (incident_id, received_at) where incident_id is not null;
create index if not exists idx_locations_received_at       on public.rrt_locations (received_at);

-- ---- forms ------------------------------------------------------------
create unique index if not exists uq_custom_forms_one_default on public.custom_forms (is_default) where is_default;
create index if not exists idx_custom_questions_form on public.custom_questions (form_id, position);

-- ---- answers and photos -------------------------------------------------
create index if not exists idx_answers_incident on public.incident_answers (incident_id);
create index if not exists idx_photos_incident  on public.incident_photos (incident_id);
create index if not exists idx_photos_question  on public.incident_photos (question_id) where question_id is not null;

-- ---- notifications -------------------------------------------------------
create index if not exists idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_user        on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_incident    on public.notifications (incident_id) where incident_id is not null;

-- ---- audit_logs ----------------------------------------------------------
create index if not exists idx_audit_entity  on public.audit_logs (entity, entity_id, created_at desc);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_actor   on public.audit_logs (actor_id) where actor_id is not null;

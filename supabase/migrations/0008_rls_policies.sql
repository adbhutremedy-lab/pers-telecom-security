-- =====================================================================
-- FILE: supabase/migrations/0008_rls_policies.sql
-- PERS Telecom Security - Phase 1 / Step 8 of 10: Row Level Security
--
-- Default is DENY. Every table has RLS switched on; policies then grant
-- exactly what each role needs. All state changes go through the
-- SECURITY DEFINER functions of step 5, so most tables have NO insert /
-- update / delete policy for signed-in users on purpose.
--
-- Roles: SUPER_ADMIN, ADMIN, OPERATOR (control room) and RRT_MEMBER.
-- Anonymous visitors (not signed in) get nothing.
-- Safe to re-run (drop policy if exists + create policy).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Table privileges
-- Supabase normally grants these automatically, but newer projects can be
-- configured not to, so they are stated explicitly here. Row level
-- security (below) decides which ROWS each signed-in user may touch.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all                            on all tables in schema public to service_role;
grant usage, select                  on all sequences in schema public to authenticated, service_role;

-- Nothing at all for anonymous visitors
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------
-- 1. Switch RLS on for all 14 tables
-- ---------------------------------------------------------------------
alter table public.roles                enable row level security;
alter table public.users                enable row level security;
alter table public.rrt_teams            enable row level security;
alter table public.rrt_locations        enable row level security;
alter table public.towers               enable row level security;
alter table public.incidents            enable row level security;
alter table public.incident_assignments enable row level security;
alter table public.custom_forms         enable row level security;
alter table public.custom_questions     enable row level security;
alter table public.incident_answers     enable row level security;
alter table public.incident_photos      enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.settings             enable row level security;

-- ---------------------------------------------------------------------
-- roles : everyone signed in may read; nobody edits from the API
-- ---------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- users
--   read   : own row; staff read everyone (names and phones)
--   update : own row (phone, push subscriptions; privileged columns are
--            protected by the users_guard trigger); Super Admin any row;
--            Administrator operators and RRT members only
--   create / delete : only through the secret key (server route)
-- ---------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or (select app.is_staff()));

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (
    id = (select auth.uid())
    or (select app.is_super())
    or ((select app.is_admin())
        and exists (select 1 from public.roles r
                     where r.id = users.role_id and r.code in ('OPERATOR', 'RRT_MEMBER')))
  )
  with check (
    id = (select auth.uid())
    or (select app.is_super())
    or ((select app.is_admin())
        and exists (select 1 from public.roles r
                     where r.id = users.role_id and r.code in ('OPERATOR', 'RRT_MEMBER')))
  );

-- ---------------------------------------------------------------------
-- rrt_teams
--   read   : staff all; an RRT member reads their own team
--   write  : admins (add, edit, deactivate); delete: Super Admin only.
--   Live columns (status, position) change only through functions.
-- ---------------------------------------------------------------------
drop policy if exists rrt_teams_select on public.rrt_teams;
create policy rrt_teams_select on public.rrt_teams
  for select to authenticated
  using ((select app.is_staff()) or id = (select app.team_id()));

drop policy if exists rrt_teams_insert on public.rrt_teams;
create policy rrt_teams_insert on public.rrt_teams
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists rrt_teams_update on public.rrt_teams;
create policy rrt_teams_update on public.rrt_teams
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists rrt_teams_delete on public.rrt_teams;
create policy rrt_teams_delete on public.rrt_teams
  for delete to authenticated
  using ((select app.is_super()));

-- ---------------------------------------------------------------------
-- rrt_locations : staff read all, a team reads its own. Rows are written
-- only by public.post_location (no insert policy).
-- ---------------------------------------------------------------------
drop policy if exists rrt_locations_select on public.rrt_locations;
create policy rrt_locations_select on public.rrt_locations
  for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.team_id()));

-- ---------------------------------------------------------------------
-- towers
--   read   : staff all; an RRT member only towers of incidents offered
--            to or handled by their team
--   write  : administrators
-- ---------------------------------------------------------------------
drop policy if exists towers_select on public.towers;
create policy towers_select on public.towers
  for select to authenticated
  using (
    (select app.is_staff())
    or exists (
      select 1
        from public.incidents i
       where i.tower_id = towers.id
         and (i.assigned_team_id = (select app.team_id())
              or exists (select 1 from public.incident_assignments a
                          where a.incident_id = i.id
                            and a.team_id = (select app.team_id())))
    )
  );

drop policy if exists towers_insert on public.towers;
create policy towers_insert on public.towers
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists towers_update on public.towers;
create policy towers_update on public.towers
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists towers_delete on public.towers;
create policy towers_delete on public.towers
  for delete to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- incidents
--   read   : staff all; an RRT member incidents offered to / handled by
--            their team. Changes only through functions.
--   delete : Super Admin only
-- ---------------------------------------------------------------------
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents
  for select to authenticated
  using (
    (select app.is_staff())
    or assigned_team_id = (select app.team_id())
    or exists (select 1 from public.incident_assignments a
                where a.incident_id = incidents.id
                  and a.team_id = (select app.team_id()))
  );

drop policy if exists incidents_delete on public.incidents;
create policy incidents_delete on public.incidents
  for delete to authenticated
  using ((select app.is_super()));

-- ---------------------------------------------------------------------
-- incident_assignments : staff all; a team reads its own offers.
-- Changes only through functions.
-- ---------------------------------------------------------------------
drop policy if exists incident_assignments_select on public.incident_assignments;
create policy incident_assignments_select on public.incident_assignments
  for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.team_id()));

-- ---------------------------------------------------------------------
-- custom_forms / custom_questions
--   read  : staff and RRT members (they must render the form)
--   write : administrators
-- ---------------------------------------------------------------------
drop policy if exists custom_forms_select on public.custom_forms;
create policy custom_forms_select on public.custom_forms
  for select to authenticated
  using ((select app.is_staff()) or (select app.team_id()) is not null);

drop policy if exists custom_forms_insert on public.custom_forms;
create policy custom_forms_insert on public.custom_forms
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists custom_forms_update on public.custom_forms;
create policy custom_forms_update on public.custom_forms
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists custom_forms_delete on public.custom_forms;
create policy custom_forms_delete on public.custom_forms
  for delete to authenticated
  using ((select app.is_admin()));

drop policy if exists custom_questions_select on public.custom_questions;
create policy custom_questions_select on public.custom_questions
  for select to authenticated
  using ((select app.is_staff()) or (select app.team_id()) is not null);

drop policy if exists custom_questions_insert on public.custom_questions;
create policy custom_questions_insert on public.custom_questions
  for insert to authenticated
  with check ((select app.is_admin()));

drop policy if exists custom_questions_update on public.custom_questions;
create policy custom_questions_update on public.custom_questions
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

drop policy if exists custom_questions_delete on public.custom_questions;
create policy custom_questions_delete on public.custom_questions
  for delete to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- incident_answers : staff all; a team reads answers of its own incidents.
-- Rows are written only by public.resolve_incident.
-- ---------------------------------------------------------------------
drop policy if exists incident_answers_select on public.incident_answers;
create policy incident_answers_select on public.incident_answers
  for select to authenticated
  using (
    (select app.is_staff())
    or exists (select 1 from public.incidents i
                where i.id = incident_answers.incident_id
                  and i.assigned_team_id = (select app.team_id()))
  );

-- ---------------------------------------------------------------------
-- incident_photos
--   read   : staff all; a team its own incidents
--   insert : staff; a team for its own ACTIVE incident (the phone inserts
--            the row right after uploading the file to Storage)
--   delete : administrators; a team may remove its own upload while the
--            incident is still active
-- ---------------------------------------------------------------------
drop policy if exists incident_photos_select on public.incident_photos;
create policy incident_photos_select on public.incident_photos
  for select to authenticated
  using (
    (select app.is_staff())
    or exists (select 1 from public.incidents i
                where i.id = incident_photos.incident_id
                  and i.assigned_team_id = (select app.team_id()))
  );

drop policy if exists incident_photos_insert on public.incident_photos;
create policy incident_photos_insert on public.incident_photos
  for insert to authenticated
  with check (
    (select app.is_staff())
    or (uploaded_by = (select auth.uid())
        and exists (select 1 from public.incidents i
                     where i.id = incident_photos.incident_id
                       and i.assigned_team_id = (select app.team_id())
                       and i.status in ('ASSIGNED', 'REACHED')))
  );

drop policy if exists incident_photos_delete on public.incident_photos;
create policy incident_photos_delete on public.incident_photos
  for delete to authenticated
  using (
    (select app.is_admin())
    or (uploaded_by = (select auth.uid())
        and exists (select 1 from public.incidents i
                     where i.id = incident_photos.incident_id
                       and i.assigned_team_id = (select app.team_id())
                       and i.status in ('ASSIGNED', 'REACHED')))
  );

-- ---------------------------------------------------------------------
-- notifications : each user reads, marks read and deletes only their own.
-- Rows are created only by database functions.
-- ---------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- audit_logs : administrators read; nobody writes (trigger only)
-- ---------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------
-- settings : every signed-in user reads (the phone needs timeouts);
-- only a Super Admin edits.
-- ---------------------------------------------------------------------
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (true);

drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to authenticated
  with check ((select app.is_super()));

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using ((select app.is_super()))
  with check ((select app.is_super()));

drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings
  for delete to authenticated
  using ((select app.is_super()));

-- ---------------------------------------------------------------------
-- Defence in depth: remove direct write privileges where only the
-- database functions may write. (Functions run as the table owner.)
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate on public.roles                from authenticated;
revoke insert, update, delete, truncate on public.rrt_locations        from authenticated;
revoke insert, update, delete, truncate on public.incident_assignments from authenticated;
revoke insert, update, delete, truncate on public.incident_answers     from authenticated;
revoke insert, update, delete, truncate on public.audit_logs           from authenticated;
revoke insert,         delete, truncate on public.users                from authenticated;
revoke insert, update,         truncate on public.incidents            from authenticated;
revoke truncate on public.towers, public.rrt_teams, public.custom_forms,
                   public.custom_questions, public.incident_photos,
                   public.notifications, public.settings              from authenticated;

-- =====================================================================
-- FILE: supabase/migrations/0010_reference_data.sql
-- PERS Telecom Security - Phase 1 / Step 10 of 10: reference data
--
-- Data the system cannot run without (NOT demo data):
--   * the four roles
--   * the tunable settings
--   * the default resolution form with its questions
-- Safe to run more than once: existing rows are updated, never duplicated.
-- Settings you have changed in the Admin panel are NOT overwritten.
-- =====================================================================

-- Do not fill the audit log with installation noise.
select set_config('pers.skip_audit', 'on', true);

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
insert into public.roles (id, code, name, description) values
  (1, 'SUPER_ADMIN', 'Super Admin', 'Full control, including administrators and system settings'),
  (2, 'ADMIN',       'Administrator', 'Manages towers, RRT teams, users, forms and reports'),
  (3, 'OPERATOR',    'Operator', 'Control-room operator: monitors the map and triggers incidents'),
  (4, 'RRT_MEMBER',  'RRT Member', 'Field team: receives offers, navigates, resolves incidents')
on conflict (id) do update
  set code = excluded.code,
      name = excluded.name,
      description = excluded.description;

-- ---------------------------------------------------------------------
-- Settings (inserted only when missing, so later edits survive a re-run)
-- ---------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('offer_timeout_seconds',   '30'::jsonb,   'Seconds a team has to accept an incident offer before it moves to the next nearest team'),
  ('retry_interval_seconds',  '60'::jsonb,   'Seconds to wait before offering again when every team has declined or timed out'),
  ('max_dispatch_rounds',     '3'::jsonb,    'How many full rounds of offers are made automatically before an operator must assign manually'),
  ('offline_after_seconds',   '45'::jsonb,   'A team with no GPS signal for this long is shown as OFFLINE'),
  ('gps_interval_seconds',    '5'::jsonb,    'How often the team phone sends its position while online'),
  ('arrival_radius_m',        '50'::jsonb,   'A team within this distance (metres) of the tower is marked REACHED automatically'),
  ('arrival_max_accuracy_m',  '100'::jsonb,  'GPS readings less accurate than this (metres) are ignored for arrival detection'),
  ('default_speed_kmh',       '40'::jsonb,   'Speed used to estimate arrival time when the team is not moving yet'),
  ('eta_fresh_seconds',       '90'::jsonb,   'How long a road-route ETA from Mapbox is trusted before the straight-line estimate is used'),
  ('location_retention_days', '30'::jsonb,   'GPS history older than this many days is deleted automatically'),
  ('report_timezone',         '"Asia/Kolkata"'::jsonb, 'Time zone used for "today" and for every report'),
  ('brand_name',              '"PERS Telecom Security"'::jsonb, 'Name shown in the app header and on reports'),
  ('demo_city',               '"Gurugram, Haryana, India"'::jsonb, 'City used by the demo data'),
  ('map_default_center',      '{"lat": 28.4595, "lng": 77.0266}'::jsonb, 'Map centre when the dashboard opens (Gurugram)'),
  ('map_default_zoom',        '11'::jsonb,   'Map zoom when the dashboard opens')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Default resolution form (fixed ids so this file can be re-run)
-- ---------------------------------------------------------------------
insert into public.custom_forms (id, name, description, is_active, is_default)
values ('f0000000-0000-4000-8000-000000000001',
        'Standard Resolution Report',
        'Filled in by the RRT member when an incident is resolved',
        true, true)
on conflict (id) do nothing;

insert into public.custom_questions
  (id, form_id, position, label, help_text, type, is_required,
   scale_min, scale_max, options, multiline, min_files, max_files)
values
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 1,
   'Was the problem fixed on site?', null, 'YES_NO', true,
   null, null, '[]'::jsonb, false, 0, 5),

  ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 2,
   'Root cause', 'Pick the closest match', 'DROPDOWN', true,
   null, null,
   '["Power failure", "Battery or DC system", "Equipment fault", "Fiber or transmission cut", "Theft or vandalism", "Unauthorized access", "Weather or environment", "Other"]'::jsonb,
   false, 0, 5),

  ('f1000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 3,
   'Work done and remarks', 'Describe what you found and what you did', 'TEXT', true,
   null, null, '[]'::jsonb, true, 0, 5),

  ('f1000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', 4,
   'Site condition after the visit', '1 = poor, 5 = excellent', 'RATING', false,
   1, 5, '[]'::jsonb, false, 0, 5),

  ('f1000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000001', 5,
   'Items replaced or repaired', 'Select everything that applies', 'MULTI_SELECT', false,
   null, null,
   '["Battery", "Rectifier", "Lock or door", "Cable", "Antenna", "Generator", "Cooling or fan", "Nothing replaced"]'::jsonb,
   false, 0, 5),

  ('f1000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000001', 6,
   'Photos of the site', 'At least one photo after the work is finished', 'PHOTO', true,
   null, null, '[]'::jsonb, false, 1, 5)
on conflict (id) do nothing;

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

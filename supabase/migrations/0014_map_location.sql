-- =====================================================================
-- 0014  Demo location: choose where the map opens (any city in the world)
--   * settings_validate now also checks map_default_center / zoom
--   * move_simulated_teams(lat, lng): relocates the simulated teams
--     around a new city so the demo can run anywhere (Super Admin only)
-- Safe to run more than once.
-- =====================================================================

create or replace function app.settings_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_num numeric;
  v_lat numeric;
  v_lng numeric;
begin
  if jsonb_typeof(new.value) = 'number' then
    v_num := (new.value #>> '{}')::numeric;
    if (new.key = 'offer_timeout_seconds'   and v_num not between 5 and 300)
    or (new.key = 'arrival_radius_m'        and v_num not between 5 and 2000)
    or (new.key = 'offline_after_seconds'   and v_num not between 15 and 600)
    or (new.key = 'gps_interval_seconds'    and v_num not between 2 and 120)
    or (new.key = 'max_dispatch_rounds'     and v_num not between 1 and 20)
    or (new.key = 'retry_interval_seconds'  and v_num not between 10 and 3600)
    or (new.key = 'location_retention_days' and v_num not between 1 and 3650)
    or (new.key = 'map_default_zoom'        and v_num not between 1 and 20) then
      raise exception 'INVALID_SETTING: value % is outside the allowed range for %', v_num, new.key;
    end if;
  end if;

  if new.key = 'map_default_center' then
    if jsonb_typeof(new.value) <> 'object'
       or jsonb_typeof(new.value -> 'lat') <> 'number'
       or jsonb_typeof(new.value -> 'lng') <> 'number' then
      raise exception 'INVALID_SETTING: map_default_center must look like {"lat": 6.52, "lng": 3.37}';
    end if;
    v_lat := (new.value ->> 'lat')::numeric;
    v_lng := (new.value ->> 'lng')::numeric;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'INVALID_SETTING: latitude must be -90..90 and longitude -180..180';
    end if;
  end if;

  if new.key = 'demo_city' and (jsonb_typeof(new.value) <> 'string' or btrim(new.value #>> '{}') = '' or length(new.value #>> '{}') > 80) then
    raise exception 'INVALID_SETTING: demo_city must be a short text';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- move_simulated_teams : park every simulated team around a new centre.
--   Ring layout, 2 to 5 km out, so they look like a real fleet.
--   Sets the base (home) position and, for teams not on a job, the live
--   position too, so "Reset demo" parks them in the new city as well.
-- ---------------------------------------------------------------------
create or replace function public.move_simulated_teams(p_lat double precision, p_lng double precision)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer;
  i integer := 0;
  v_rad double precision;
  v_ang double precision;
  v_lat double precision;
  v_lng double precision;
  v_radii constant double precision[] := array[2500, 4200, 3300, 5000, 2000, 3800, 4600, 2800, 3500];
begin
  if not (app.is_super() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only a Super Admin can move the simulated teams' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -85 and 85 or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION: latitude must be -85..85 and longitude -180..180';
  end if;

  select count(*) into n from public.rrt_teams where is_simulated and is_active;
  if n = 0 then
    return 0;
  end if;

  for r in select id, current_incident_id from public.rrt_teams where is_simulated and is_active order by code loop
    v_rad := v_radii[(i % array_length(v_radii, 1)) + 1];
    v_ang := radians(20.0 + i * (360.0 / n));
    v_lat := p_lat + (v_rad * cos(v_ang)) / 111320.0;
    v_lng := p_lng + (v_rad * sin(v_ang)) / (111320.0 * cos(radians(p_lat)));

    if r.current_incident_id is null then
      update public.rrt_teams
         set home_lat = v_lat, home_lng = v_lng,
             last_lat = v_lat, last_lng = v_lng,
             last_speed_kmh = 0, last_heading = null,
             last_seen_at = now()
       where id = r.id;
    else
      update public.rrt_teams set home_lat = v_lat, home_lng = v_lng where id = r.id;
    end if;
    i := i + 1;
  end loop;

  delete from public.rrt_locations
   where team_id in (select id from public.rrt_teams where is_simulated and current_incident_id is null);
  return i;
end
$$;

revoke all on function public.move_simulated_teams(double precision, double precision) from public, anon;
grant execute on function public.move_simulated_teams(double precision, double precision) to authenticated, service_role;

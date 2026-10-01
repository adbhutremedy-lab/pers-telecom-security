-- =====================================================================
-- FILE: supabase/PASTE_4_phase4_admin.sql  (same content as migrations/0012_admin_and_import.sql)
-- HOW TO USE: Supabase > SQL Editor > New query > paste this whole file > Run.
-- Expected result: "Success. No rows returned". Safe to run more than once.
-- =====================================================================

-- =====================================================================
-- FILE: supabase/migrations/0012_admin_and_import.sql
-- PERS Telecom Security - Phase 4: functions behind the Admin panel
--
--   public.admin_create_user(...)      create a login (Super Admin only)
--   public.admin_set_password(...)     set a new password (Super Admin only)
--   public.admin_update_user(...)      name / phone / role / team / active
--   public.admin_import_towers(...)    validate + load towers from Excel/CSV
--   public.admin_import_teams(...)     validate + load RRT teams from Excel/CSV
--   public.admin_reorder_questions(...) change the order of form questions
--   public.admin_duplicate_form(...)   copy a resolution form with its questions
--
-- Everything else in the Admin panel (edit one tower, one team, forms and
-- questions, settings) uses the normal tables with the security rules from
-- Phase 1, so no new rules are needed for those.
-- No Supabase secret key is needed: logins are created with the same SQL
-- method that seed_02_users.sql already uses.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- helper: write the Auth account (shared by create user)
-- ---------------------------------------------------------------------
create or replace function app.create_auth_login(p_email text, p_password text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := gen_random_uuid();
  v_hash text := extensions.crypt(p_password, extensions.gen_salt('bf'));
  v_col  text;
begin
  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
     p_email, v_hash, now(),
     '{"provider": "email", "providers": ["email"]}'::jsonb,
     jsonb_build_object('full_name', p_full_name),
     now(), now());

  foreach v_col in array array['confirmation_token', 'recovery_token', 'email_change_token_new',
                               'email_change', 'email_change_token_current',
                               'phone_change', 'phone_change_token', 'reauthentication_token']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and column_name = v_col) then
      execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', v_col, v_col) using v_uid;
    end if;
  end loop;

  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
    insert into auth.identities
      (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      (gen_random_uuid(), v_uid::text, v_uid,
       jsonb_build_object('sub', v_uid::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now());
  else
    insert into auth.identities
      (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      (v_uid::text, v_uid,
       jsonb_build_object('sub', v_uid::text, 'email', p_email),
       'email', now(), now(), now());
  end if;
  return v_uid;
end
$$;

revoke all on function app.create_auth_login(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- admin_create_user : Super Admin creates a login
-- ---------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_email     text,
  p_password  text,
  p_full_name text,
  p_role      public.role_code,
  p_phone     text default null,
  p_team_id   uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid   uuid;
  v_role  smallint;
begin
  if not (app.is_super() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only a Super Admin can create logins' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL: "%" is not a valid e-mail address', p_email;
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD: the password needs at least 8 characters';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'NAME_REQUIRED: enter the person''s name';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'EMAIL_TAKEN: a login with this e-mail already exists';
  end if;

  if p_role = 'RRT_MEMBER' then
    if p_team_id is null or not exists (select 1 from public.rrt_teams t where t.id = p_team_id and t.is_active) then
      raise exception 'TEAM_REQUIRED: choose an active RRT team for this login';
    end if;
    if exists (select 1 from public.users u join public.roles r on r.id = u.role_id
                where u.rrt_team_id = p_team_id and r.code = 'RRT_MEMBER' and u.is_active) then
      raise exception 'TEAM_HAS_LOGIN: this team already has an active login. Deactivate it first';
    end if;
  else
    p_team_id := null;
  end if;

  select r.id into v_role from public.roles r where r.code = p_role;

  v_uid := app.create_auth_login(v_email, p_password, trim(p_full_name));

  insert into public.users (id, email, full_name, phone, role_id, rrt_team_id, is_active)
  values (v_uid, v_email, trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), v_role, p_team_id, true);

  return jsonb_build_object('id', v_uid, 'email', v_email, 'role', p_role);
end
$$;

-- ---------------------------------------------------------------------
-- admin_set_password : Super Admin sets a new password
-- ---------------------------------------------------------------------
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_super() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: only a Super Admin can set passwords' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD: the password needs at least 8 characters';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND: that login does not exist';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- admin_update_user : edit a person
--   Super Admin : everything (role, team, active, name, phone)
--   Administrator: name, phone, team, active of Operators and RRT members
--   Nobody can deactivate or demote themselves, or the last Super Admin.
-- ---------------------------------------------------------------------
create or replace function public.admin_update_user(
  p_user_id   uuid,
  p_full_name text,
  p_phone     text,
  p_role      public.role_code,
  p_team_id   uuid,
  p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := (select auth.uid());
  v_old      public.users%rowtype;
  v_old_role public.role_code;
  v_role_id  smallint;
  v_supers   integer;
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: administrators only' using errcode = '42501';
  end if;

  select * into v_old from public.users where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND: that person does not exist';
  end if;
  select r.code into v_old_role from public.roles r where r.id = v_old.role_id;

  if not (app.is_super() or app.is_service()) then
    if v_old_role in ('SUPER_ADMIN', 'ADMIN') then
      raise exception 'PERMISSION_DENIED: only a Super Admin can change an administrator' using errcode = '42501';
    end if;
    if p_role is distinct from v_old_role then
      raise exception 'PERMISSION_DENIED: only a Super Admin can change a role' using errcode = '42501';
    end if;
  end if;

  if p_user_id = v_me and (p_is_active is false or p_role is distinct from v_old_role) then
    raise exception 'NOT_ALLOWED: you cannot deactivate or change the role of your own login';
  end if;

  if v_old_role = 'SUPER_ADMIN' and (p_is_active is false or p_role <> 'SUPER_ADMIN') then
    select count(*) into v_supers
      from public.users u join public.roles r on r.id = u.role_id
     where r.code = 'SUPER_ADMIN' and u.is_active and u.id <> p_user_id;
    if v_supers = 0 then
      raise exception 'NOT_ALLOWED: this is the last active Super Admin';
    end if;
  end if;

  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'NAME_REQUIRED: enter the person''s name';
  end if;

  if p_role = 'RRT_MEMBER' then
    if p_team_id is null or not exists (select 1 from public.rrt_teams t where t.id = p_team_id) then
      raise exception 'TEAM_REQUIRED: choose an RRT team for this login';
    end if;
    if p_is_active and exists (select 1 from public.users u join public.roles r on r.id = u.role_id
                                where u.rrt_team_id = p_team_id and r.code = 'RRT_MEMBER'
                                  and u.is_active and u.id <> p_user_id) then
      raise exception 'TEAM_HAS_LOGIN: this team already has another active login';
    end if;
  else
    p_team_id := null;
  end if;

  select r.id into v_role_id from public.roles r where r.code = p_role;

  update public.users
     set full_name   = trim(p_full_name),
         phone       = nullif(trim(coalesce(p_phone, '')), ''),
         role_id     = v_role_id,
         rrt_team_id = p_team_id,
         is_active   = coalesce(p_is_active, is_active)
   where id = p_user_id;

  -- A deactivated person can no longer sign in at all.
  begin
    update auth.users
       set banned_until = case when coalesce(p_is_active, true) then null else 'infinity'::timestamptz end
     where id = p_user_id;
  exception when others then
    null; -- the profile flag alone already blocks access to the apps
  end;

  return jsonb_build_object('id', p_user_id, 'role', p_role, 'is_active', p_is_active);
end
$$;

-- ---------------------------------------------------------------------
-- admin_import_towers : p_rows is a JSON array of objects with
--   tower_number, site_name, lat, lng, region, [status], [address]
-- p_dry_run = true only checks; false saves (and refuses if any row is bad)
-- ---------------------------------------------------------------------
create or replace function public.admin_import_towers(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_errors jsonb := '[]'::jsonb;
  v_ins    integer := 0;
  v_upd    integer := 0;
  v_num    text;
  v_name   text;
  v_region text;
  v_lat    double precision;
  v_lng    double precision;
  v_status text;
  v_addr   text;
  v_seen   text[] := '{}';
  v_exists boolean;
  v_msg    text;
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: administrators only' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_IMPORT: the rows must be a list';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'INVALID_IMPORT: the file has no rows';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'INVALID_IMPORT: at most 2000 rows per import';
  end if;

  for r in select e.value as row, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e(value, ordinality)
  loop
    v_msg := null;
    v_num    := upper(trim(coalesce(r.row ->> 'tower_number', '')));
    v_name   := trim(coalesce(r.row ->> 'site_name', ''));
    v_region := trim(coalesce(r.row ->> 'region', ''));
    v_status := upper(trim(coalesce(nullif(r.row ->> 'status', ''), 'ACTIVE')));
    v_addr   := nullif(trim(coalesce(r.row ->> 'address', '')), '');
    v_lat := null; v_lng := null;
    begin v_lat := nullif(trim(coalesce(r.row ->> 'lat', '')), '')::double precision; exception when others then v_msg := 'latitude is not a number'; end;
    begin v_lng := nullif(trim(coalesce(r.row ->> 'lng', '')), '')::double precision; exception when others then v_msg := coalesce(v_msg || '; ', '') || 'longitude is not a number'; end;

    if v_num = '' then v_msg := coalesce(v_msg || '; ', '') || 'tower_number is empty';
    elsif length(v_num) > 40 then v_msg := coalesce(v_msg || '; ', '') || 'tower_number is longer than 40 characters'; end if;
    if v_name = '' then v_msg := coalesce(v_msg || '; ', '') || 'site_name is empty'; end if;
    if v_region = '' then v_msg := coalesce(v_msg || '; ', '') || 'region is empty'; end if;
    if v_lat is null or v_lat not between -90 and 90 then v_msg := coalesce(v_msg || '; ', '') || 'lat must be a number between -90 and 90'; end if;
    if v_lng is null or v_lng not between -180 and 180 then v_msg := coalesce(v_msg || '; ', '') || 'lng must be a number between -180 and 180'; end if;
    if v_status not in ('ACTIVE', 'INACTIVE', 'MAINTENANCE') then v_msg := coalesce(v_msg || '; ', '') || 'status must be ACTIVE, INACTIVE or MAINTENANCE'; end if;
    if v_num <> '' and v_num = any (v_seen) then v_msg := coalesce(v_msg || '; ', '') || 'tower_number appears twice in the file'; end if;
    v_seen := v_seen || v_num;

    if v_msg is not null then
      v_errors := v_errors || jsonb_build_object('row', r.n + 1, 'tower_number', v_num, 'message', v_msg);
      continue;
    end if;

    select exists (select 1 from public.towers t where t.tower_number = v_num) into v_exists;
    if v_exists then v_upd := v_upd + 1; else v_ins := v_ins + 1; end if;

    if not p_dry_run then
      insert into public.towers (tower_number, site_name, lat, lng, region, status, address, created_by)
      values (v_num, v_name, v_lat, v_lng, v_region, v_status::public.tower_status, v_addr, (select auth.uid()))
      on conflict (tower_number) do update
        set site_name  = excluded.site_name,
            lat        = excluded.lat,
            lng        = excluded.lng,
            region     = excluded.region,
            status     = excluded.status,
            address    = coalesce(excluded.address, public.towers.address),
            deleted_at = null;
    end if;
  end loop;

  if not p_dry_run and jsonb_array_length(v_errors) > 0 then
    raise exception 'INVALID_IMPORT: % row(s) have problems. Nothing was saved. Run the check first and fix the file', jsonb_array_length(v_errors);
  end if;

  return jsonb_build_object(
    'total',     jsonb_array_length(p_rows),
    'to_insert', v_ins,
    'to_update', v_upd,
    'errors',    v_errors,
    'applied',   (not p_dry_run));
end
$$;

-- ---------------------------------------------------------------------
-- admin_import_teams : rows with code, name, [mobile], [vehicle_plate],
--   [vehicle_model], [region], [home_lat], [home_lng]
-- An existing team keeps its live status; only its details change.
-- ---------------------------------------------------------------------
create or replace function public.admin_import_teams(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_errors jsonb := '[]'::jsonb;
  v_ins    integer := 0;
  v_upd    integer := 0;
  v_code   text;
  v_name   text;
  v_lat    double precision;
  v_lng    double precision;
  v_seen   text[] := '{}';
  v_msg    text;
  v_exists boolean;
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: administrators only' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_IMPORT: the rows must be a list';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'INVALID_IMPORT: the file has no rows';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'INVALID_IMPORT: at most 500 rows per import';
  end if;

  for r in select e.value as row, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e(value, ordinality)
  loop
    v_msg := null;
    v_code := upper(trim(coalesce(r.row ->> 'code', '')));
    v_name := trim(coalesce(r.row ->> 'name', ''));
    v_lat := null; v_lng := null;
    begin v_lat := nullif(trim(coalesce(r.row ->> 'home_lat', '')), '')::double precision; exception when others then v_msg := 'home_lat is not a number'; end;
    begin v_lng := nullif(trim(coalesce(r.row ->> 'home_lng', '')), '')::double precision; exception when others then v_msg := coalesce(v_msg || '; ', '') || 'home_lng is not a number'; end;

    if v_code = '' then v_msg := coalesce(v_msg || '; ', '') || 'code is empty';
    elsif length(v_code) > 20 then v_msg := coalesce(v_msg || '; ', '') || 'code is longer than 20 characters'; end if;
    if v_name = '' then v_msg := coalesce(v_msg || '; ', '') || 'name is empty'; end if;
    if (v_lat is null) <> (v_lng is null) then v_msg := coalesce(v_msg || '; ', '') || 'give both home_lat and home_lng or neither'; end if;
    if v_lat is not null and v_lat not between -90 and 90 then v_msg := coalesce(v_msg || '; ', '') || 'home_lat must be between -90 and 90'; end if;
    if v_lng is not null and v_lng not between -180 and 180 then v_msg := coalesce(v_msg || '; ', '') || 'home_lng must be between -180 and 180'; end if;
    if v_code <> '' and v_code = any (v_seen) then v_msg := coalesce(v_msg || '; ', '') || 'code appears twice in the file'; end if;
    v_seen := v_seen || v_code;

    if v_msg is not null then
      v_errors := v_errors || jsonb_build_object('row', r.n + 1, 'code', v_code, 'message', v_msg);
      continue;
    end if;

    select exists (select 1 from public.rrt_teams t where t.code = v_code) into v_exists;
    if v_exists then v_upd := v_upd + 1; else v_ins := v_ins + 1; end if;

    if not p_dry_run then
      insert into public.rrt_teams (code, name, mobile, vehicle_plate, vehicle_model, region, home_lat, home_lng)
      values (v_code, v_name,
              nullif(trim(coalesce(r.row ->> 'mobile', '')), ''),
              nullif(trim(coalesce(r.row ->> 'vehicle_plate', '')), ''),
              nullif(trim(coalesce(r.row ->> 'vehicle_model', '')), ''),
              nullif(trim(coalesce(r.row ->> 'region', '')), ''),
              v_lat, v_lng)
      on conflict (code) do update
        set name          = excluded.name,
            mobile        = coalesce(excluded.mobile, public.rrt_teams.mobile),
            vehicle_plate = coalesce(excluded.vehicle_plate, public.rrt_teams.vehicle_plate),
            vehicle_model = coalesce(excluded.vehicle_model, public.rrt_teams.vehicle_model),
            region        = coalesce(excluded.region, public.rrt_teams.region),
            home_lat      = coalesce(excluded.home_lat, public.rrt_teams.home_lat),
            home_lng      = coalesce(excluded.home_lng, public.rrt_teams.home_lng);
    end if;
  end loop;

  if not p_dry_run and jsonb_array_length(v_errors) > 0 then
    raise exception 'INVALID_IMPORT: % row(s) have problems. Nothing was saved. Run the check first and fix the file', jsonb_array_length(v_errors);
  end if;

  return jsonb_build_object(
    'total',     jsonb_array_length(p_rows),
    'to_insert', v_ins,
    'to_update', v_upd,
    'errors',    v_errors,
    'applied',   (not p_dry_run));
end
$$;

-- ---------------------------------------------------------------------
-- grants: only signed-in users can call; the functions check the role
-- ---------------------------------------------------------------------
revoke all on function public.admin_create_user(text, text, text, public.role_code, text, uuid) from public, anon;
revoke all on function public.admin_set_password(uuid, text)                                   from public, anon;
revoke all on function public.admin_update_user(uuid, text, text, public.role_code, uuid, boolean) from public, anon;
revoke all on function public.admin_import_towers(jsonb, boolean)                              from public, anon;
revoke all on function public.admin_import_teams(jsonb, boolean)                               from public, anon;
grant execute on function public.admin_create_user(text, text, text, public.role_code, text, uuid) to authenticated, service_role;
grant execute on function public.admin_set_password(uuid, text)                                   to authenticated, service_role;
grant execute on function public.admin_update_user(uuid, text, text, public.role_code, uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_import_towers(jsonb, boolean)                              to authenticated, service_role;
grant execute on function public.admin_import_teams(jsonb, boolean)                               to authenticated, service_role;

-- ---------------------------------------------------------------------
-- admin_reorder_questions : put the questions of a form in a new order
-- (one call = one transaction, so the "unique position" rule is safe)
-- ---------------------------------------------------------------------
create or replace function public.admin_reorder_questions(p_form_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: administrators only' using errcode = '42501';
  end if;
  select count(*) into v_n from public.custom_questions q where q.form_id = p_form_id;
  if coalesce(array_length(p_ids, 1), 0) <> v_n
     or exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.custom_questions q where q.id = i and q.form_id = p_form_id)) then
    raise exception 'INVALID_ORDER: the list does not match the questions of this form';
  end if;

  -- constraint custom_questions_form_position_uq is deferred, so any order is fine inside one transaction
  update public.custom_questions q
     set position = o.ord
    from (select i, ordinality::integer as ord from unnest(p_ids) with ordinality t(i, ordinality)) o
   where q.id = o.i;
end
$$;

-- ---------------------------------------------------------------------
-- admin_duplicate_form : copy a form with all its questions
-- ---------------------------------------------------------------------
create or replace function public.admin_duplicate_form(p_form_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new  uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'PERMISSION_DENIED: administrators only' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'NAME_REQUIRED: give the new form a name';
  end if;
  if not exists (select 1 from public.custom_forms f where f.id = p_form_id) then
    raise exception 'FORM_NOT_FOUND: that form does not exist';
  end if;

  insert into public.custom_forms (name, description, is_active, is_default, created_by)
  select v_name, f.description, true, false, (select auth.uid())
    from public.custom_forms f where f.id = p_form_id
  returning id into v_new;

  insert into public.custom_questions
    (form_id, position, label, help_text, type, is_required, scale_min, scale_max, options, multiline, min_files, max_files, is_active)
  select v_new, q.position, q.label, q.help_text, q.type, q.is_required, q.scale_min, q.scale_max, q.options, q.multiline, q.min_files, q.max_files, q.is_active
    from public.custom_questions q where q.form_id = p_form_id;

  return v_new;
end
$$;

revoke all on function public.admin_reorder_questions(uuid, uuid[]) from public, anon;
revoke all on function public.admin_duplicate_form(uuid, text)      from public, anon;
grant execute on function public.admin_reorder_questions(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.admin_duplicate_form(uuid, text)      to authenticated, service_role;

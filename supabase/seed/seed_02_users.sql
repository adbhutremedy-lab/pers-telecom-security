-- =====================================================================
-- FILE: supabase/seed/seed_02_users.sql
-- PERS Telecom Security - Phase 1 seed 2 of 3: demo login accounts
--
-- Creates one login per person and one login per RRT team:
--
--   adbhutremedy@gmail.com   Super Admin      (you)
--   admin@pers.example       Administrator
--   operator1@pers.example   Operator
--   operator2@pers.example   Operator
--   rrt01@pers.example ... rrt10@pers.example   one per RRT team
--
-- Every account gets the SAME demo password (below). CHANGE IT after the
-- demo: Supabase dashboard > Authentication > Users.
--
-- How it works
--   1. For each account: if no Supabase Auth user with that e-mail exists,
--      this script creates it (e-mail already confirmed).
--   2. Then it creates the matching profile row in public.users.
-- If step 1 is refused on your project (this does not normally happen) the
-- script prints a NOTICE. In that case create the users by hand in
-- Authentication > Users > Add user (tick "Auto Confirm User"), using the
-- e-mails above, and run this file again: it only fills in what is missing.
-- Safe to run more than once.
-- =====================================================================

select set_config('pers.skip_audit', 'on', true);

do $$
declare
  c_password constant text := 'PersDemo@2026';    -- <-- demo password for every account
  a record;
  v_uid uuid;
  v_role_id smallint;
  v_team uuid;
  v_hash text;
  v_col text;
begin
  v_hash := extensions.crypt(c_password, extensions.gen_salt('bf'));

  for a in
    select * from (values
      ('adbhutremedy@gmail.com', 'Bimad',              'SUPER_ADMIN', null,     '+91 98100 10001'),
      ('admin@pers.example',     'Demo Administrator', 'ADMIN',       null,     '+91 98100 10002'),
      ('operator1@pers.example', 'Control Room Operator 1', 'OPERATOR', null,   '+91 98100 10003'),
      ('operator2@pers.example', 'Control Room Operator 2', 'OPERATOR', null,   '+91 98100 10004'),
      ('rrt01@pers.example', 'Alpha Team Member',   'RRT_MEMBER', 'RRT-01', '+91 98100 00001'),
      ('rrt02@pers.example', 'Bravo Team Member',   'RRT_MEMBER', 'RRT-02', '+91 98100 00002'),
      ('rrt03@pers.example', 'Charlie Team Member', 'RRT_MEMBER', 'RRT-03', '+91 98100 00003'),
      ('rrt04@pers.example', 'Delta Team Member',   'RRT_MEMBER', 'RRT-04', '+91 98100 00004'),
      ('rrt05@pers.example', 'Echo Team Member',    'RRT_MEMBER', 'RRT-05', '+91 98100 00005'),
      ('rrt06@pers.example', 'Foxtrot Team Member', 'RRT_MEMBER', 'RRT-06', '+91 98100 00006'),
      ('rrt07@pers.example', 'Golf Team Member',    'RRT_MEMBER', 'RRT-07', '+91 98100 00007'),
      ('rrt08@pers.example', 'Hotel Team Member',   'RRT_MEMBER', 'RRT-08', '+91 98100 00008'),
      ('rrt09@pers.example', 'India Team Member',   'RRT_MEMBER', 'RRT-09', '+91 98100 00009'),
      ('rrt10@pers.example', 'Juliet Team Member',  'RRT_MEMBER', 'RRT-10', '+91 98100 00010')
    ) as t(email, full_name, role_code, team_code, phone)
  loop
    -- 1. Supabase Auth account ------------------------------------------
    select u.id into v_uid from auth.users u where lower(u.email) = a.email;

    if v_uid is null then
      begin
        v_uid := gen_random_uuid();

        insert into auth.users
          (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values
          ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
           a.email, v_hash, now(),
           '{"provider": "email", "providers": ["email"]}'::jsonb,
           jsonb_build_object('full_name', a.full_name),
           now(), now());

        -- GoTrue cannot read rows where these text columns are NULL.
        foreach v_col in array array['confirmation_token', 'recovery_token', 'email_change_token_new',
                                     'email_change', 'email_change_token_current',
                                     'phone_change', 'phone_change_token', 'reauthentication_token']
        loop
          if exists (select 1 from information_schema.columns
                      where table_schema = 'auth' and table_name = 'users' and column_name = v_col) then
            execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', v_col, v_col) using v_uid;
          end if;
        end loop;

        -- Identity row: required for e-mail + password sign-in.
        if exists (select 1 from information_schema.columns
                    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
          insert into auth.identities
            (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
          values
            (gen_random_uuid(), v_uid::text, v_uid,
             jsonb_build_object('sub', v_uid::text, 'email', a.email,
                                'email_verified', true, 'phone_verified', false),
             'email', now(), now(), now());
        else
          insert into auth.identities
            (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
          values
            (v_uid::text, v_uid,
             jsonb_build_object('sub', v_uid::text, 'email', a.email),
             'email', now(), now(), now());
        end if;
      exception when others then
        v_uid := null;
        raise notice 'Could not create the login for % automatically (%). Create it in Authentication > Users, then run this file again.', a.email, sqlerrm;
      end;
    end if;

    -- 2. Profile row ------------------------------------------------------
    if v_uid is not null then
      select r.id into v_role_id from public.roles r where r.code = a.role_code::public.role_code;
      select t.id into v_team from public.rrt_teams t where t.code = a.team_code;

      insert into public.users (id, email, full_name, phone, role_id, rrt_team_id, is_active)
      values (v_uid, a.email, a.full_name, a.phone, v_role_id, v_team, true)
      on conflict (id) do update
        set email       = excluded.email,
            full_name   = excluded.full_name,
            phone       = excluded.phone,
            role_id     = excluded.role_id,
            rrt_team_id = excluded.rrt_team_id,
            is_active   = true;
    end if;
  end loop;
end
$$;

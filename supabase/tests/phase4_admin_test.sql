-- =====================================================================
-- FILE: supabase/tests/phase4_admin_test.sql
-- PERS Telecom Security - Phase 4 acceptance test for the Admin functions.
-- Run AFTER migration 0012 in the Supabase SQL Editor. One table at the end:
-- every row must say PASS. It cleans up after itself.
-- =====================================================================
create temp table if not exists _t4 (n serial primary key, test text, ok boolean, detail text);
truncate _t4;
grant all on _t4 to public;
grant all on sequence _t4_n_seq to public;

create or replace function pg_temp.chk(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t4 (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;

create or replace function pg_temp.claims(p_uid uuid)
returns text language sql as $$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aud', 'authenticated')::text $$;

do $$
declare
  v_super uuid; v_admin uuid; v_op uuid;
  v_res jsonb; v_err text; v_new uuid; v_team uuid; v_team2 uuid; v_n int;
  v_form uuid; v_copy uuid; v_ids uuid[]; v_first text;
begin
  select id into v_super from public.users where email = 'adbhutremedy@gmail.com';
  select id into v_admin from public.users where email = 'admin@pers.example';
  select id into v_op    from public.users where email = 'operator1@pers.example';
  select id into v_team  from public.rrt_teams where code = 'RRT-10';

  -- ---- Operator is refused everything --------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  begin perform public.admin_create_user('x@pers.example','Password123','X','OPERATOR'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('operator cannot create a login', v_err like 'PERMISSION_DENIED%', v_err);
  begin perform public.admin_import_towers('[{"tower_number":"T1"}]'::jsonb, true); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('operator cannot import towers', v_err like 'PERMISSION_DENIED%', v_err);
  reset role;

  -- ---- Administrator: no login creation, no role change ----------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  begin perform public.admin_create_user('y@pers.example','Password123','Y','OPERATOR'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('administrator cannot create a login', v_err like 'PERMISSION_DENIED%', v_err);
  begin perform public.admin_update_user(v_op, 'Control Room Operator 1', null, 'ADMIN', null, true); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('administrator cannot promote someone', v_err like 'PERMISSION_DENIED%', v_err);
  begin perform public.admin_update_user(v_super, 'Bimad', null, 'SUPER_ADMIN', null, false); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('administrator cannot touch the Super Admin', v_err like 'PERMISSION_DENIED%', v_err);
  perform public.admin_update_user(v_op, 'Control Room Operator One', '+91 1', 'OPERATOR', null, true);
  perform pg_temp.chk('administrator can edit an operator''s name and phone',
    (select full_name from public.users where id = v_op) = 'Control Room Operator One');
  reset role;

  -- ---- Super Admin: create / duplicates / validation ------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_super), true);
  set local role authenticated;
  begin perform public.admin_create_user('bad-mail','Password123','Bad','OPERATOR'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('bad e-mail refused', v_err like 'INVALID_EMAIL%', v_err);
  begin perform public.admin_create_user('short@pers.example','abc','Short','OPERATOR'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('short password refused', v_err like 'WEAK_PASSWORD%', v_err);
  begin perform public.admin_create_user('operator1@pers.example','Password123','Dup','OPERATOR'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('duplicate e-mail refused', v_err like 'EMAIL_TAKEN%', v_err);
  begin perform public.admin_create_user('rrtx@pers.example','Password123','RRT X','RRT_MEMBER'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('RRT login needs a team', v_err like 'TEAM_REQUIRED%', v_err);
  begin perform public.admin_create_user('rrty@pers.example','Password123','RRT Y','RRT_MEMBER', null, v_team); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('a team with an active login cannot get a second one', v_err like 'TEAM_HAS_LOGIN%', v_err);

  v_res := public.admin_create_user('new.operator@pers.example','Password123','New Operator','OPERATOR','+91 99');
  v_new := (v_res ->> 'id')::uuid;
  perform pg_temp.chk('Super Admin creates an operator', v_new is not null and exists (select 1 from public.users where id = v_new and is_active));
  reset role;
  perform pg_temp.chk('auth account has a working password hash',
    exists (select 1 from auth.users u where u.id = v_new and u.encrypted_password = extensions.crypt('Password123', u.encrypted_password)));
  set local role authenticated;
  reset role;
  perform pg_temp.chk('identity row exists for sign-in', exists (select 1 from auth.identities i where i.user_id = v_new));
  set local role authenticated;

  perform public.admin_set_password(v_new, 'Another#Pass9');
  reset role;
  perform pg_temp.chk('password changed',
    exists (select 1 from auth.users u where u.id = v_new and u.encrypted_password = extensions.crypt('Another#Pass9', u.encrypted_password)));
  set local role authenticated;

  perform public.admin_update_user(v_new, 'New Operator', null, 'ADMIN', null, true);
  perform pg_temp.chk('Super Admin changes a role', (select r.code from public.users u join public.roles r on r.id = u.role_id where u.id = v_new) = 'ADMIN');
  perform public.admin_update_user(v_new, 'New Operator', null, 'OPERATOR', null, false);
  perform pg_temp.chk('deactivated user is flagged inactive', not (select is_active from public.users where id = v_new));
  reset role;
  perform pg_temp.chk('deactivated user is blocked from signing in', (select banned_until from auth.users where id = v_new) > now() + interval '10 years');
  set local role authenticated;
  perform public.admin_update_user(v_new, 'New Operator', null, 'OPERATOR', null, true);
  reset role;
  perform pg_temp.chk('reactivated user can sign in again', (select banned_until from auth.users where id = v_new) is null);
  set local role authenticated;

  begin perform public.admin_update_user(v_super, 'Bimad', null, 'SUPER_ADMIN', null, false); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('nobody can deactivate their own login', v_err like 'NOT_ALLOWED%', v_err);

  -- ---- tower import -----------------------------------------------------
  v_res := public.admin_import_towers('[
    {"tower_number":"imp-001","site_name":"Import One","lat":"28.45","lng":77.02,"region":"Sector 29"},
    {"tower_number":"GGN-001","site_name":"Cyber Hub Tower","lat":28.4948,"lng":77.0885,"region":"Cyber City","status":"maintenance"},
    {"tower_number":"","site_name":"","lat":"abc","lng":500,"region":""},
    {"tower_number":"IMP-001","site_name":"Dup","lat":28.4,"lng":77.0,"region":"X"}
  ]'::jsonb, true);
  perform pg_temp.chk('dry run: counts and errors', (v_res ->> 'to_insert') = '1' and (v_res ->> 'to_update') = '1' and jsonb_array_length(v_res -> 'errors') = 2, v_res::text);
  perform pg_temp.chk('dry run saves nothing', not exists (select 1 from public.towers where tower_number = 'IMP-001'));
  begin perform public.admin_import_towers('[{"tower_number":"","site_name":"x","lat":1,"lng":1,"region":"r"}]'::jsonb, false); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('real import refuses a file with errors', v_err like 'INVALID_IMPORT%', v_err);
  v_res := public.admin_import_towers('[
    {"tower_number":"imp-001","site_name":"Import One","lat":"28.45","lng":77.02,"region":"Sector 29","address":"Test road"},
    {"tower_number":"imp-002","site_name":"Import Two","lat":28.46,"lng":77.03,"region":"Sector 30","status":"inactive"}
  ]'::jsonb, false);
  perform pg_temp.chk('import inserts, upper-cases the number', (v_res ->> 'to_insert') = '2' and exists (select 1 from public.towers where tower_number = 'IMP-001' and address = 'Test road'));
  v_res := public.admin_import_towers('[{"tower_number":"IMP-001","site_name":"Import One (renamed)","lat":28.45,"lng":77.02,"region":"Sector 29"}]'::jsonb, false);
  perform pg_temp.chk('import updates an existing tower', (v_res ->> 'to_update') = '1' and (select site_name from public.towers where tower_number = 'IMP-001') = 'Import One (renamed)'
     and (select address from public.towers where tower_number = 'IMP-001') = 'Test road');
  perform pg_temp.chk('status read case-insensitively', (select status::text from public.towers where tower_number = 'IMP-002') = 'INACTIVE');

  -- ---- team import ------------------------------------------------------
  v_res := public.admin_import_teams('[
    {"code":"rrt-90","name":"Imported Team","mobile":"+91 1","region":"Gurugram","home_lat":28.45,"home_lng":77.02},
    {"code":"RRT-10","name":"Juliet Team (renamed)"},
    {"code":"RRT-91","name":"Half position","home_lat":28.4}
  ]'::jsonb, true);
  perform pg_temp.chk('team dry run flags half a position', jsonb_array_length(v_res -> 'errors') = 1 and (v_res ->> 'to_insert') = '1' and (v_res ->> 'to_update') = '1', v_res::text);
  select status::text into v_err from public.rrt_teams where code = 'RRT-10';
  perform public.admin_import_teams('[{"code":"rrt-90","name":"Imported Team","mobile":"+91 1","home_lat":28.45,"home_lng":77.02},{"code":"RRT-10","name":"Juliet Team (renamed)"}]'::jsonb, false);
  perform pg_temp.chk('team import creates and updates', exists (select 1 from public.rrt_teams where code = 'RRT-90') and (select name from public.rrt_teams where code = 'RRT-10') = 'Juliet Team (renamed)');
  perform pg_temp.chk('team import keeps live status', (select status::text from public.rrt_teams where code = 'RRT-10') = v_err);
  reset role;


  -- ---- forms: duplicate + reorder ---------------------------------------------
  set local role authenticated;
  select id into v_form from public.custom_forms where is_default limit 1;
  v_copy := public.admin_duplicate_form(v_form, 'Test copy');
  perform pg_temp.chk('duplicate form copies every question',
    (select count(*) from public.custom_questions where form_id = v_copy) = (select count(*) from public.custom_questions where form_id = v_form)
    and not (select is_default from public.custom_forms where id = v_copy));
  select array_agg(id order by position desc) into v_ids from public.custom_questions where form_id = v_copy;
  perform public.admin_reorder_questions(v_copy, v_ids);
  select label into v_first from public.custom_questions where form_id = v_copy order by position limit 1;
  perform pg_temp.chk('reorder reverses the questions', v_first = 'Photos of the site', v_first);
  begin perform public.admin_reorder_questions(v_copy, v_ids[1:2]); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('reorder refuses an incomplete list', v_err like 'INVALID_ORDER%', v_err);
  reset role;
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  begin perform public.admin_duplicate_form(v_form, 'Nope'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('operator cannot copy forms', v_err like 'PERMISSION_DENIED%', v_err);
  reset role;
  delete from public.custom_forms where id = v_copy;

  -- ---- clean up ------------------------------------------------------------
  perform set_config('pers.skip_audit', 'on', true);
  delete from public.users where id = v_new;
  delete from auth.users where id = v_new;
  delete from public.towers where tower_number in ('IMP-001', 'IMP-002');
  delete from public.rrt_teams where code = 'RRT-90';
  update public.rrt_teams set name = 'Juliet Team' where code = 'RRT-10';
  update public.users set full_name = 'Control Room Operator 1', phone = '+91 98100 10003' where id = v_op;
  update public.towers set status = 'ACTIVE' where tower_number = 'GGN-001';
end
$$;

select n, test, case when ok then 'PASS' else 'FAIL' end as result, detail from _t4 order by n;
select count(*) filter (where not ok) as failures, count(*) as total from _t4;

-- =====================================================================
-- FILE: supabase/tests/phase5_radio_test.sql
-- PERS Telecom Security - Phase 5 acceptance test for messages and voice.
-- Run AFTER migration 0013 in the Supabase SQL Editor. One table at the end:
-- every row must say PASS. It cleans up after itself.
-- =====================================================================
create temp table if not exists _t5 (n serial primary key, test text, ok boolean, detail text);
truncate _t5;
grant all on _t5 to public;
grant all on sequence _t5_n_seq to public;

create or replace function pg_temp.chk(p_test text, p_ok boolean, p_detail text default null)
returns void language sql as $$ insert into _t5 (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;

create or replace function pg_temp.claims(p_uid uuid)
returns text language sql as $$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aud', 'authenticated')::text $$;

do $$
declare
  v_super uuid; v_admin uuid; v_op uuid; v_r1 uuid; v_r2 uuid;
  v_t1 uuid; v_t2 uuid;
  v_res jsonb; v_err text; v_n int; v_m1 uuid; v_m2 uuid; v_m3 uuid; v_voice text; v_old_status text;
begin
  select id into v_super from public.users where email = 'adbhutremedy@gmail.com';
  select id into v_admin from public.users where email = 'admin@pers.example';
  select id into v_op    from public.users where email = 'operator1@pers.example';
  select id into v_r1    from public.users where email = 'rrt01@pers.example';
  select id into v_r2    from public.users where email = 'rrt02@pers.example';
  select id into v_t1 from public.rrt_teams where code = 'RRT-01';
  select id into v_t2 from public.rrt_teams where code = 'RRT-02';
  select status::text into v_old_status from public.rrt_teams where code = 'RRT-01';
  update public.rrt_teams set status = 'OFFLINE' where is_active;   -- start from "nobody online"

  -- ---- Operator: no access --------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  begin perform public.send_message('TEXT', 'hi', null, null, null, 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('operator cannot send a message', v_err like 'PERMISSION_DENIED%', v_err);
  reset role;

  -- ---- Administrator: validation ----------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  begin perform public.send_message('TEXT', '   ', null, null, null, 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('empty text refused', v_err like 'INVALID_MESSAGE%', v_err);
  begin perform public.send_message('TEXT', repeat('x', 501), null, null, null, 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('501 characters refused', v_err like 'INVALID_MESSAGE%', v_err);
  begin perform public.send_message('TEXT', 'hello', null, null, null, 'TEAM', null); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('team required for a single-team message', v_err like 'INVALID_MESSAGE%', v_err);
  begin perform public.send_message('TEXT', 'hello', null, null, null, 'ALL_ONLINE', null); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('"all online" with nobody online refused', v_err like 'NO_ONLINE_TEAMS%', v_err);
  begin perform public.send_message('TEXT', 'hello', null, null, null, 'EVERYONE', null); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('unknown target refused', v_err like 'INVALID_MESSAGE%', v_err);

  -- ---- Administrator -> one team ----------------------------------------
  v_res := public.send_message('TEXT', 'Please report your ETA', null, null, null, 'TEAM', v_t1);
  v_m1 := (v_res ->> 'id')::uuid;
  perform pg_temp.chk('text to one team is sent to 1 recipient', (v_res ->> 'recipients') = '1', v_res::text);
  perform pg_temp.chk('sender label names the admin', (select sender_label from public.messages where id = v_m1) like '%(Control Room)');

  -- ---- voice validation ----------------------------------------------------------
  begin perform public.send_message('VOICE', null, v_r1::text || '/abcdefgh1234.webm', 3, 'audio/webm', 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('voice file in someone else''s folder refused', v_err like 'INVALID_MESSAGE%', v_err);
  begin perform public.send_message('VOICE', null, v_admin::text || '/../etc.webm', 3, 'audio/webm', 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('odd voice file name refused', v_err like 'INVALID_MESSAGE%', v_err);
  begin perform public.send_message('VOICE', null, v_admin::text || '/abcdefgh1234.webm', 0.1, 'audio/webm', 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('0.1 second clip refused', v_err like 'INVALID_MESSAGE%', v_err);
  begin perform public.send_message('VOICE', null, v_admin::text || '/abcdefgh1234.webm', 61, 'audio/webm', 'TEAM', v_t1); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('61 second clip refused', v_err like 'INVALID_MESSAGE%', v_err);
  v_voice := v_admin::text || '/voiceclip0001.webm';
  v_res := public.send_message('VOICE', null, v_voice, 4.26, 'audio/webm', 'TEAM', v_t1);
  v_m2 := (v_res ->> 'id')::uuid;
  perform pg_temp.chk('voice clip to one team sent', (v_res ->> 'recipients') = '1');
  perform pg_temp.chk('voice seconds stored with one decimal', (select audio_seconds from public.messages where id = v_m2) = 4.3);
  reset role;

  -- ---- bring RRT-01 online: "all online" now reaches it (simulated teams are skipped)
  update public.rrt_teams set status = 'AVAILABLE' where id = v_t1;
  update public.rrt_teams set status = 'AVAILABLE' where code = 'RRT-03';   -- RRT-03 is simulated
  perform set_config('request.jwt.claims', pg_temp.claims(v_super), true);
  set local role authenticated;
  v_res := public.send_message('TEXT', 'All teams: shift change at 18:00', null, null, null, 'ALL_ONLINE', null);
  v_m3 := (v_res ->> 'id')::uuid;
  perform pg_temp.chk('broadcast reaches only the online team with a phone', (v_res ->> 'recipients') = '1', v_res::text);
  perform pg_temp.chk('broadcast stores the recipient list', (select recipient_team_ids from public.messages where id = v_m3) = array[v_t1]);
  reset role;
  perform pg_temp.chk('phone alert row created for the recipient',
    exists (select 1 from public.notifications where user_id = v_r1 and type = 'SYSTEM' and payload ->> 'kind' = 'message'));

  -- ---- who can read what -----------------------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_r1), true);
  set local role authenticated;
  select count(*) into v_n from public.messages;
  perform pg_temp.chk('RRT-01 reads the 3 messages addressed to it', v_n = 3, v_n::text);
  perform pg_temp.chk('RRT-01 may open the voice file', app.can_hear_voice(v_voice));
  begin insert into public.messages (kind, body, sender_label, target_type) values ('TEXT','fake','x','TEAM'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('a phone cannot insert into messages directly', v_err is not null, v_err);
  begin update public.messages set body = 'edited' where id = v_m1; v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('a phone cannot edit a message', v_err is not null, v_err);
  reset role;

  perform set_config('request.jwt.claims', pg_temp.claims(v_r2), true);
  set local role authenticated;
  select count(*) into v_n from public.messages;
  perform pg_temp.chk('RRT-02 sees none of them', v_n = 0, v_n::text);
  perform pg_temp.chk('RRT-02 may not open the voice file', not app.can_hear_voice(v_voice));
  reset role;

  perform set_config('request.jwt.claims', pg_temp.claims(v_op), true);
  set local role authenticated;
  select count(*) into v_n from public.messages;
  perform pg_temp.chk('operator reads no messages', v_n = 0, v_n::text);
  reset role;

  -- ---- read / heard receipts ----------------------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_r2), true);
  set local role authenticated;
  select public.messages_mark_heard(array[v_m1, v_m2]) into v_n;
  perform pg_temp.chk('RRT-02 cannot mark a message that was not for it', v_n = 0, v_n::text);
  reset role;
  perform set_config('request.jwt.claims', pg_temp.claims(v_r1), true);
  set local role authenticated;
  select public.messages_mark_heard(array[v_m1, v_m2, v_m3]) into v_n;
  perform pg_temp.chk('RRT-01 marks its 3 messages heard', v_n = 3, v_n::text);
  select public.messages_mark_heard(array[v_m1, v_m2, v_m3]) into v_n;
  perform pg_temp.chk('marking twice changes nothing', v_n = 0, v_n::text);

  -- ---- RRT-01 -> control room ---------------------------------------------------------
  v_res := public.send_message('TEXT', 'ETA 10 minutes', null, null, null, 'ALL_ONLINE', v_t2);
  perform pg_temp.chk('a phone message always goes to the control room', 
    (select target_type from public.messages where id = (v_res ->> 'id')::uuid) = 'CONTROL_ROOM'
    and (select recipient_team_ids from public.messages where id = (v_res ->> 'id')::uuid) = '{}'
    and (select sender_team_id from public.messages where id = (v_res ->> 'id')::uuid) = v_t1);
  perform pg_temp.chk('the phone sender label is the team', (select sender_label from public.messages where id = (v_res ->> 'id')::uuid) like 'RRT-01 %');
  begin perform public.send_message('VOICE', null, v_r1::text || '/phoneclip0001.webm', 2.5, 'audio/webm', 'CONTROL_ROOM', null); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.chk('phone can send a voice clip', v_err is null, v_err);
  reset role;

  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  select count(*) into v_n from public.messages where sender_team_id = v_t1;
  perform pg_temp.chk('administrator sees the messages from the team', v_n = 2, v_n::text);
  select count(*) into v_n from public.message_receipts where team_id = v_t1;
  perform pg_temp.chk('administrator sees the receipts', v_n = 3, v_n::text);
  perform pg_temp.chk('administrator may open the phone''s voice file', app.can_hear_voice(v_r1::text || '/phoneclip0001.webm'));
  reset role;
  perform set_config('request.jwt.claims', pg_temp.claims(v_r2), true);
  set local role authenticated;
  select count(*) into v_n from public.messages;
  perform pg_temp.chk('RRT-02 cannot read what RRT-01 sent', v_n = 0, v_n::text);
  reset role;

  -- ---- rate limit ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', pg_temp.claims(v_admin), true);
  set local role authenticated;
  for i in 1..45 loop
    begin perform public.send_message('TEXT', 'spam ' || i, null, null, null, 'TEAM', v_t1); v_err := null;
    exception when others then v_err := sqlerrm; exit; end;
  end loop;
  perform pg_temp.chk('sending more than 40 messages a minute is slowed down', v_err like 'RATE_LIMIT%', v_err);
  reset role;

  -- ---- clean up ----------------------------------------------------------------------------
  delete from public.messages;
  delete from public.notifications where type = 'SYSTEM' and payload ->> 'kind' = 'message';
  update public.rrt_teams set status = 'OFFLINE' where is_active;
  update public.rrt_teams set status = v_old_status::public.team_status where id = v_t1;
end
$$;

select n, test, case when ok then 'PASS' else 'FAIL' end as result, detail from _t5 order by n;
select count(*) filter (where not ok) as failures, count(*) as total from _t5;

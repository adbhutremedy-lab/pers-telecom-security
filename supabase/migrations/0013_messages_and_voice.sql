-- =====================================================================
-- FILE: supabase/migrations/0013_messages_and_voice.sql
-- PERS Telecom Security - Phase 5: text messages and push-to-talk voice
--
--   public.messages           one row per text message or voice clip
--   public.message_receipts   which team has read / heard which message
--   public.send_message(...)  the ONLY way to send (checks role + target)
--   public.messages_mark_heard(...)   a team marks messages as read/heard
--   Storage bucket "voice-messages" (private) + access policies
--
-- Who may do what
--   Super Admin / Administrator : send to one team or to every ONLINE team,
--                                 read everything
--   RRT member (phone)          : send to the control room only, read what
--                                 was sent to the team or by the team
--   Operators                   : no access (as requested by the client)
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null,
  body               text,
  audio_path         text unique,
  audio_seconds      numeric(5,1),
  audio_mime         text,
  sender_id          uuid references public.users (id) on delete set null,
  sender_label       text not null,
  sender_team_id     uuid references public.rrt_teams (id) on delete set null,
  target_type        text not null,
  target_team_id     uuid references public.rrt_teams (id) on delete set null,
  recipient_team_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  constraint messages_kind_chk   check (kind in ('TEXT', 'VOICE')),
  constraint messages_target_chk check (target_type in ('TEAM', 'ALL_ONLINE', 'CONTROL_ROOM')),
  constraint messages_content_chk check (
    (kind = 'TEXT'  and body is not null and length(body) between 1 and 500 and audio_path is null)
    or
    (kind = 'VOICE' and audio_path is not null and audio_seconds is not null and audio_seconds between 0.3 and 60)
  )
);

create index if not exists idx_messages_created   on public.messages (created_at desc);
create index if not exists idx_messages_target    on public.messages (target_team_id, created_at desc);
create index if not exists idx_messages_sender_t  on public.messages (sender_team_id, created_at desc);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages (id) on delete cascade,
  team_id    uuid not null references public.rrt_teams (id) on delete cascade,
  heard_at   timestamptz not null default now(),
  primary key (message_id, team_id)
);
create index if not exists idx_message_receipts_team on public.message_receipts (team_id);

alter table public.messages         enable row level security;
alter table public.message_receipts enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    (select app.is_admin())
    or ((select app.team_id()) is not null
        and ((select app.team_id()) = any (recipient_team_ids)
             or sender_team_id = (select app.team_id())))
  );

drop policy if exists message_receipts_select on public.message_receipts;
create policy message_receipts_select on public.message_receipts
  for select to authenticated
  using ((select app.is_admin()) or team_id = (select app.team_id()));

-- nobody writes these tables directly: only the functions below
revoke insert, update, delete, truncate on public.messages         from authenticated;
revoke insert, update, delete, truncate on public.message_receipts from authenticated;
grant select on public.messages, public.message_receipts to authenticated;
grant all    on public.messages, public.message_receipts to service_role;
revoke all   on public.messages, public.message_receipts from anon;

-- ---------------------------------------------------------------------
-- send_message
--   p_kind        'TEXT' or 'VOICE'
--   p_target_type 'TEAM' | 'ALL_ONLINE' (admins) ; RRT members always
--                 send to the control room, whatever they pass
-- ---------------------------------------------------------------------
create or replace function public.send_message(
  p_kind          text,
  p_text          text,
  p_audio_path    text,
  p_audio_seconds numeric,
  p_audio_mime    text,
  p_target_type   text,
  p_target_team_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_role    public.role_code := app.user_role();
  v_label   text;
  v_team    uuid;
  v_target  text;
  v_tteam   uuid;
  v_recips  uuid[] := '{}';
  v_text    text := nullif(btrim(coalesce(p_text, '')), '');
  v_id      uuid;
  v_title   text;
  v_body    text;
  t         uuid;
begin
  if v_uid is null or v_role is null then
    raise exception 'PERMISSION_DENIED: sign in first' using errcode = '42501';
  end if;
  if v_role not in ('SUPER_ADMIN', 'ADMIN', 'RRT_MEMBER') then
    raise exception 'PERMISSION_DENIED: only administrators and response teams can send messages' using errcode = '42501';
  end if;
  if p_kind not in ('TEXT', 'VOICE') then
    raise exception 'INVALID_MESSAGE: the message must be text or voice';
  end if;
  if p_kind = 'TEXT' then
    if v_text is null then raise exception 'INVALID_MESSAGE: type a message first'; end if;
    if length(v_text) > 500 then raise exception 'INVALID_MESSAGE: a message can have at most 500 characters'; end if;
  else
    if p_audio_path is null or p_audio_path !~ '^[0-9a-f-]{36}/[0-9a-zA-Z_-]{8,64}\.(webm|ogg|m4a|mp4|mp3|wav|aac)$'
       or split_part(p_audio_path, '/', 1) <> v_uid::text then
      raise exception 'INVALID_MESSAGE: the voice file name is not valid';
    end if;
    if p_audio_seconds is null or p_audio_seconds < 0.3 then
      raise exception 'INVALID_MESSAGE: the voice message is too short';
    end if;
    if p_audio_seconds > 60 then
      raise exception 'INVALID_MESSAGE: a voice message can be at most 60 seconds';
    end if;
  end if;

  if (select count(*) from public.messages m where m.sender_id = v_uid and m.created_at > now() - interval '60 seconds') >= 40 then
    raise exception 'RATE_LIMIT: too many messages in one minute, wait a moment';
  end if;

  if v_role = 'RRT_MEMBER' then
    v_team := app.team_id();
    if v_team is null then
      raise exception 'PERMISSION_DENIED: your login is not linked to a team' using errcode = '42501';
    end if;
    select t2.code || ' ' || t2.name into v_label from public.rrt_teams t2 where t2.id = v_team;
    v_target := 'CONTROL_ROOM';
  else
    select u.full_name || ' (Control Room)' into v_label from public.users u where u.id = v_uid;
    v_target := p_target_type;
    if v_target = 'TEAM' then
      if p_target_team_id is null then raise exception 'INVALID_MESSAGE: choose a team'; end if;
      if not exists (select 1 from public.rrt_teams x where x.id = p_target_team_id and x.is_active) then
        raise exception 'INVALID_MESSAGE: that team does not exist or is deactivated';
      end if;
      v_tteam := p_target_team_id;
      v_recips := array[p_target_team_id];
    elsif v_target = 'ALL_ONLINE' then
      select coalesce(array_agg(x.id), '{}') into v_recips
        from public.rrt_teams x
       where x.is_active and not x.is_simulated and x.status <> 'OFFLINE'
         and exists (select 1 from public.users u where u.rrt_team_id = x.id and u.is_active);
      if coalesce(array_length(v_recips, 1), 0) = 0 then
        raise exception 'NO_ONLINE_TEAMS: no team with a phone is online right now';
      end if;
    else
      raise exception 'INVALID_MESSAGE: choose one team or all online teams';
    end if;
  end if;

  insert into public.messages
    (kind, body, audio_path, audio_seconds, audio_mime, sender_id, sender_label, sender_team_id,
     target_type, target_team_id, recipient_team_ids)
  values
    (p_kind, case when p_kind = 'TEXT' then v_text end,
     case when p_kind = 'VOICE' then p_audio_path end,
     case when p_kind = 'VOICE' then round(p_audio_seconds, 1) end,
     case when p_kind = 'VOICE' then left(coalesce(p_audio_mime, 'audio/webm'), 60) end,
     v_uid, v_label, v_team, v_target, v_tteam, v_recips)
  returning id into v_id;

  -- lock-screen alert for the phones (only does something if Phase 3 push is set up)
  if coalesce(array_length(v_recips, 1), 0) > 0 then
    v_title := 'Message from Control Room';
    v_body  := case when p_kind = 'TEXT' then left(v_text, 140)
                    else 'Voice message (' || round(p_audio_seconds)::text || ' s)' end;
    foreach t in array v_recips loop
      perform app.notify_team(t, 'SYSTEM', null, null, v_title, v_body,
                              jsonb_build_object('kind', 'message', 'message_id', v_id));
    end loop;
  end if;

  return jsonb_build_object('id', v_id, 'recipients', coalesce(array_length(v_recips, 1), 0));
end
$$;

-- ---------------------------------------------------------------------
-- messages_mark_heard : the phone reports "read" (text) / "played" (voice)
-- ---------------------------------------------------------------------
create or replace function public.messages_mark_heard(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid := app.team_id();
  v_n    integer;
begin
  if v_team is null or app.user_role() <> 'RRT_MEMBER' then
    raise exception 'PERMISSION_DENIED: only a response team can do this' using errcode = '42501';
  end if;
  insert into public.message_receipts (message_id, team_id)
  select m.id, v_team
    from public.messages m
   where m.id = any (coalesce(p_ids, '{}'))
     and v_team = any (m.recipient_team_ids)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.send_message(text, text, text, numeric, text, text, uuid) from public, anon;
revoke all on function public.messages_mark_heard(uuid[]) from public, anon;
grant execute on function public.send_message(text, text, text, numeric, text, text, uuid) to authenticated, service_role;
grant execute on function public.messages_mark_heard(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['messages', 'message_receipts']
  loop
    begin
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      execute format('alter table public.%I replica identity full', t);
    exception when others then
      raise notice 'Could not publish table % to realtime: %', t, sqlerrm;
    end;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Voice files: private bucket + who may upload / listen
--   upload : the signed-in sender, into a folder named after their user id
--   listen : administrators; a team for messages sent to it or by it; the uploader
-- ---------------------------------------------------------------------
create or replace function app.can_hear_voice(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or (storage.foldername(p_object_name))[1] = (select auth.uid())::text
      or exists (
           select 1 from public.messages m
            where m.audio_path = p_object_name
              and app.team_id() is not null
              and (app.team_id() = any (m.recipient_team_ids) or m.sender_team_id = app.team_id()))
$$;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage schema not found - skipping voice bucket creation (not a Supabase project?)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('voice-messages', 'voice-messages', false, 5 * 1024 * 1024,
          array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac',
                'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/mp3'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception when others then
  raise notice 'Could not create the voice-messages bucket automatically (%). Create it by hand: Storage > New bucket > name voice-messages > Private.', sqlerrm;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists "pers_voice_select" on storage.objects;
  drop policy if exists "pers_voice_insert" on storage.objects;

  create policy "pers_voice_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'voice-messages' and app.can_hear_voice(name));

  create policy "pers_voice_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'voice-messages'
                and (storage.foldername(name))[1] = (select auth.uid())::text
                and app.user_role() in ('SUPER_ADMIN', 'ADMIN', 'RRT_MEMBER'));
exception when others then
  raise notice 'Could not create the voice storage policies automatically (%). See docs/PHASE5_RADIO_GUIDE.md, Troubleshooting.', sqlerrm;
end
$$;

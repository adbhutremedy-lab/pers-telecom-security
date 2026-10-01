-- =====================================================================
-- FILE: supabase/PASTE_3_phase3_phone_support.sql  (same content as migrations/0011_phone_support_and_push.sql)
-- HOW TO USE: Supabase > SQL Editor > New query > paste this whole file > Run.
-- PERS Telecom Security - Phase 3: support for the RRT phone app
--
--   1. public.server_time()      the phone asks the database for the exact
--                                time so the 30-second countdown is right
--                                even when the phone clock is wrong
--   2. Web Push (OPTIONAL)       lets a locked phone show the alert:
--        public.push_subscriptions   one row per phone that allowed alerts
--        public.register_push / unregister_push   called by the phone
--        app.push_config             the web address + shared secret of the
--                                    push relay (filled in by you, once)
--        trigger on notifications    sends team alerts to the relay
--        public.push_targets / push_report   called by the relay only
--
-- Nothing here changes the dispatch rules. If you never configure push,
-- everything still works (the phone shows alerts while the app is open).
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Server clock
-- ---------------------------------------------------------------------
create or replace function public.server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

revoke all on function public.server_time() from public, anon;
grant execute on function public.server_time() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2a. pg_net (lets the database call the relay on the web). Guarded.
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net could not be enabled automatically (%). Push alerts for a locked phone need it: Database > Extensions > pg_net > enable, then run this file again.', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------
-- 2b. Subscriptions
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_chk check (endpoint like 'https://%' and length(endpoint) <= 2048)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Rows are written only by register_push (no insert / update policy).
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create or replace function public.register_push(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'PERMISSION_DENIED: sign in first' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 2048
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'INVALID_SUBSCRIPTION: the push subscription is not valid';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_seen_at = now();
end
$$;

create or replace function public.unregister_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions
   where endpoint = p_endpoint
     and user_id = (select auth.uid());
end
$$;

revoke all on function public.register_push(text, text, text, text) from public, anon;
revoke all on function public.unregister_push(text)                  from public, anon;
grant execute on function public.register_push(text, text, text, text) to authenticated, service_role;
grant execute on function public.unregister_push(text)                  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2c. Relay configuration (one row; nobody can read it through the API)
-- ---------------------------------------------------------------------
create table if not exists app.push_config (
  id         boolean primary key default true,
  url        text not null,
  secret     text not null,
  updated_at timestamptz not null default now(),
  constraint push_config_single_row check (id),
  constraint push_config_url_chk check (url like 'https://%'),
  constraint push_config_secret_chk check (length(secret) >= 24)
);

alter table app.push_config enable row level security;
revoke all on app.push_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2d. Trigger: every alert addressed to a team is handed to the relay
-- A failure here must never block the dispatch engine, so it is swallowed.
-- ---------------------------------------------------------------------
create or replace function app.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg app.push_config%rowtype;
  v_exp timestamptz;
begin
  if new.team_id is null then
    return new;
  end if;

  select * into v_cfg from app.push_config limit 1;
  if not found then
    return new;
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return new;
  end if;

  if new.assignment_id is not null then
    select a.expires_at into v_exp from public.incident_assignments a where a.id = new.assignment_id;
  end if;

  perform net.http_post(
    url     := v_cfg.url,
    body    := jsonb_build_object(
                 'notification_id', new.id,
                 'user_id',         new.user_id,
                 'team_id',         new.team_id,
                 'type',            new.type,
                 'title',           new.title,
                 'body',            new.body,
                 'incident_id',     new.incident_id,
                 'assignment_id',   new.assignment_id,
                 'expires_at',      v_exp),
    params  := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pers-secret', v_cfg.secret),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;
end
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function app.push_on_notification();

-- ---------------------------------------------------------------------
-- 2e. Functions the relay calls (with the publishable key). They work only
-- when the shared secret matches app.push_config.secret.
-- ---------------------------------------------------------------------
create or replace function public.push_targets(p_secret text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or not exists (select 1 from app.push_config c where c.secret = p_secret) then
    perform pg_sleep(0.5);
    raise exception 'PERMISSION_DENIED: wrong secret' using errcode = '42501';
  end if;

  return coalesce((select jsonb_agg(jsonb_build_object(
                            'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s
                    where s.user_id = p_user_id), '[]'::jsonb);
end
$$;

create or replace function public.push_report(
  p_secret          text,
  p_notification_id uuid,
  p_sent            integer,
  p_dead            text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or not exists (select 1 from app.push_config c where c.secret = p_secret) then
    perform pg_sleep(0.5);
    raise exception 'PERMISSION_DENIED: wrong secret' using errcode = '42501';
  end if;

  if coalesce(array_length(p_dead, 1), 0) > 0 then
    delete from public.push_subscriptions where endpoint = any (p_dead);
  end if;

  if p_sent > 0 then
    update public.notifications set push_sent_at = now() where id = p_notification_id;
  end if;
end
$$;

revoke all on function public.push_targets(text, uuid)               from public;
revoke all on function public.push_report(text, uuid, integer, text[]) from public;
grant execute on function public.push_targets(text, uuid)               to anon, authenticated, service_role;
grant execute on function public.push_report(text, uuid, integer, text[]) to anon, authenticated, service_role;

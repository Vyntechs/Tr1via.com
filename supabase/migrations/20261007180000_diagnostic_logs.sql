-- 20261007180000_diagnostic_logs.sql
--
-- Diagnostic logs: a private flight recorder for "why did it lag at 7:06?".
-- Nothing here changes a game rule. The server and the devices write rows
-- here AFTER they have already answered the player, and the game never reads
-- them back.
--
--   diag_answer_events  every answer tap the server saw, saved or not
--                       (late, early, duplicate, turned down), with the
--                       phone's own tap time and the server's step timings.
--   diag_server_actions every host control press (reveal, next, end early...)
--                       and every timer-end resolve call, with how long the
--                       sign-in check, the database and the broadcast took.
--   diag_device_events  small reports from phones, the TV and the host
--                       laptop: broadcast heard, room re-download times,
--                       connection changes, the "switch to a hotspot"
--                       screen, slow frames.
--   diag_quota          how many rows each night (and each phone / TV / host
--                       inside it) has been given so far, so a flood of junk
--                       cannot fill the disk. See diag_take_rows() below.
--   diag_night_timeline() a read-only FUNCTION (not a view, see below) that
--                       lines all of it up by time for one night (see
--                       docs/diagnostics/night-timeline.md).
--
-- Safe to run more than once: tables and indexes are "if not exists",
-- functions are "create or replace", grants are repeatable.
--
-- Rules:
--   - Written ONLY by the server with the service-role key, and only when
--     the DIAGNOSTIC_LOGGING env flag is "on" (off by default in code).
--   - RLS is on with NO policies, and anon/authenticated have no grants, so
--     a browser can never read or write any of it.
--   - No foreign keys on purpose: a turned-down tap can carry ids the
--     database has never seen, and a reset must not wipe the evidence.
--   - Personal data is limited to the device id already stored on `players`
--     and (device events only) a short device summary: browser family +
--     major version, OS family, device class, connection type, coarse screen
--     class. No raw user-agent text, exact screen size, memory or CPU-core
--     numbers. Display names are NOT copied here; the timeline function joins
--     them from `players`.
--   - The timeline is a function on purpose. A view would be recorded as
--     depending on the columns of players, answers, reveals, games, questions
--     and categories, and Postgres would then refuse to change or drop any of
--     them. A function written with a plain string body is looked up only when
--     it runs, so later changes to those tables are never blocked by this
--     migration.
--   - Retention: 45 days. cleanup_diagnostic_logs() deletes older rows, one
--     small batch per call. Nothing in this migration schedules it: the app
--     calls it daily from /api/cron/diag-cleanup. See the docs file.

set search_path = public, extensions;

-- ─── every answer tap ──────────────────────────────────────────────────
create table if not exists public.diag_answer_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Server arrival time: the clock the deadline check really used.
  received_at timestamptz not null,
  engine text not null
    check (engine in ('legacy', 'resilient_v1', 'unknown')),
  night_id uuid,
  game_id uuid,
  question_id uuid,
  play_id uuid,
  player_id uuid,
  device_id uuid,
  slot_chosen smallint,
  chosen_index smallint,
  -- What the phone says about itself. Its clock can be wrong, so compare
  -- these to each other (sent - tap = how long the phone held the tap), not
  -- to received_at, unless you also correct for clock drift.
  client_tap_at timestamptz,
  client_sent_at timestamptz,
  client_attempt smallint,
  -- What the server saw on the question when the tap arrived.
  question_played_at timestamptz,
  question_finished_at timestamptz,
  ms_after_open integer,
  deadline_s smallint,
  outcome text not null
    check (outcome in ('saved', 'duplicate', 'late', 'early', 'rejected', 'error')),
  reason text not null check (length(reason) <= 64),
  http_status smallint not null,
  total_ms integer,
  steps jsonb not null default '{}'::jsonb
    check (pg_column_size(steps) <= 2048),
  cold_start boolean,
  instance_id text check (length(instance_id) <= 32),
  region text check (length(region) <= 32),
  deployment text check (length(deployment) <= 64)
);

comment on table public.diag_answer_events is
  'One row per answer tap the server received, saved or not. Service role only. 45-day retention.';

create index if not exists diag_answer_events_night_time_idx
  on public.diag_answer_events (night_id, received_at);
create index if not exists diag_answer_events_question_time_idx
  on public.diag_answer_events (question_id, received_at);
create index if not exists diag_answer_events_created_idx
  on public.diag_answer_events (created_at);

-- ─── host control presses and timer-end resolves ───────────────────────
create table if not exists public.diag_server_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Press-received time on the server.
  received_at timestamptz not null,
  action text not null check (length(action) between 1 and 32),
  -- host = signed-in host pressed it; timer = a phone or the TV asked the
  -- server to close the question when its clock hit zero.
  actor text not null check (actor in ('host', 'timer', 'system')),
  night_id uuid,
  game_id uuid,
  question_id uuid,
  play_id uuid,
  http_status smallint not null,
  outcome text not null check (length(outcome) <= 32),
  reason text not null check (length(reason) <= 64),
  -- Milliseconds after received_at.
  total_ms integer,
  auth_ms integer,
  db_done_ms integer,
  broadcast_start_ms integer,
  broadcast_done_ms integer,
  broadcast_ok boolean,
  broadcast_error text check (length(broadcast_error) <= 32),
  steps jsonb not null default '{}'::jsonb
    check (pg_column_size(steps) <= 2048),
  cold_start boolean,
  instance_id text check (length(instance_id) <= 32),
  region text check (length(region) <= 32),
  deployment text check (length(deployment) <= 64)
);

comment on table public.diag_server_actions is
  'One row per host control press or timer-end resolve call, with step timings. Service role only. 45-day retention.';

create index if not exists diag_server_actions_night_time_idx
  on public.diag_server_actions (night_id, received_at);
create index if not exists diag_server_actions_question_time_idx
  on public.diag_server_actions (question_id, received_at);
create index if not exists diag_server_actions_created_idx
  on public.diag_server_actions (created_at);

-- ─── reports from phones, the TV and the host laptop ───────────────────
create table if not exists public.diag_device_events (
  id uuid primary key default gen_random_uuid(),
  -- When the server received the batch.
  created_at timestamptz not null default now(),
  night_id uuid,
  surface text not null check (surface in ('player', 'tv', 'host')),
  -- A random id for one page load, so a refresh starts a new session.
  session_id text not null check (length(session_id) between 1 and 48),
  -- The signed device cookie, when there is one (phones and the host).
  device_id uuid,
  kind text not null check (length(kind) between 1 and 24),
  -- The device's own clock when it happened.
  device_at timestamptz not null,
  -- device_at moved onto the server's clock using this batch's drift
  -- estimate (server receive time minus device send time). Good to about
  -- the upload delay. The timeline sorts on this.
  at_est timestamptz not null,
  offset_ms integer,
  -- True for slow or failed events that are always kept (never sampled).
  forced boolean not null default false,
  data jsonb not null default '{}'::jsonb
    check (pg_column_size(data) <= 4096)
);

comment on table public.diag_device_events is
  'Small batched reports from player phones, the TV and the host laptop. Service role only. 45-day retention.';

create index if not exists diag_device_events_night_time_idx
  on public.diag_device_events (night_id, at_est);
create index if not exists diag_device_events_device_time_idx
  on public.diag_device_events (night_id, device_id, at_est);
create index if not exists diag_device_events_created_idx
  on public.diag_device_events (created_at);

-- ─── row caps ──────────────────────────────────────────────────────────
-- One row per (night, source). bucket "_night" is the whole night; the others
-- are "p:<device id>" (one player phone), "tv" and "host". The server asks
-- diag_take_rows() for room BEFORE it stores rows, and stores only as many as
-- it was granted, so the caps hold across every server instance.
create table if not exists public.diag_quota (
  night_id uuid not null,
  bucket text not null check (length(bucket) between 1 and 48),
  rows_taken integer not null default 0,
  -- Rows turned away because a cap was reached (useful after a flood).
  rows_refused integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (night_id, bucket)
);

comment on table public.diag_quota is
  'How many diagnostic rows each night and each source inside it has used. Service role only. 45-day retention.';

create index if not exists diag_quota_updated_idx
  on public.diag_quota (updated_at);

-- ─── lock it down ──────────────────────────────────────────────────────
-- Supabase's default privileges hand new public tables to the browser
-- roles; take them back. RLS on with no policies is the second lock.
alter table public.diag_answer_events enable row level security;
alter table public.diag_server_actions enable row level security;
alter table public.diag_device_events enable row level security;
alter table public.diag_quota enable row level security;

revoke all privileges on table public.diag_answer_events from public, anon, authenticated;
revoke all privileges on table public.diag_server_actions from public, anon, authenticated;
revoke all privileges on table public.diag_device_events from public, anon, authenticated;
revoke all privileges on table public.diag_quota from public, anon, authenticated;

grant select, insert, delete on table public.diag_answer_events to service_role;
grant select, insert, delete on table public.diag_server_actions to service_role;
grant select, insert, delete on table public.diag_device_events to service_role;
grant select, delete on table public.diag_quota to service_role;

-- ─── ask for room before storing rows ──────────────────────────────────
-- Returns how many of p_want rows may be stored (0 when a cap is reached) and
-- counts the rest as refused. Both caps are checked in one step: the night as a
-- whole (p_night_cap) and the source inside it (p_bucket_cap). The caps come
-- from the caller, which is trusted server code (service role only).
--
-- It NEVER WAITS FOR A LOCK. Logging must not hold a database connection that
-- real answers could be using, so:
--   - it first takes a per-night TRY-lock (pg_try_advisory_xact_lock). If
--     another call is updating the same night's counter right now it returns
--     -1 ("busy") immediately; the caller backs off for a few milliseconds
--     without holding a connection and asks again, or drops the rows;
--   - any row lock it still needs gives up after 50 ms (lock_timeout) and also
--     returns -1;
--   - it touches only diag_quota, never a game table, so it cannot conflict
--     with an answer, a reveal or a resolve.
create or replace function public.diag_take_rows(
  p_night_id uuid,
  p_bucket text,
  p_want integer,
  p_bucket_cap integer,
  p_night_cap integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want integer;
  v_night integer;
  v_bucket integer;
  v_grant integer;
begin
  if p_night_id is null or p_bucket is null or p_want is null or p_want < 1
     or p_bucket_cap is null or p_night_cap is null
     or pg_catalog.length(p_bucket) not between 1 and 48 then
    return 0;
  end if;
  v_want := least(p_want, 1000);

  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_night_id::text, 7)) then
    return -1;
  end if;
  perform pg_catalog.set_config('lock_timeout', '50ms', true);

  begin
    -- Always lock the night's row first, then the source's row.
    insert into public.diag_quota (night_id, bucket) values (p_night_id, '_night')
      on conflict do nothing;
    select q.rows_taken into v_night from public.diag_quota q
      where q.night_id = p_night_id and q.bucket = '_night' for update;
    insert into public.diag_quota (night_id, bucket) values (p_night_id, p_bucket)
      on conflict do nothing;
    select q.rows_taken into v_bucket from public.diag_quota q
      where q.night_id = p_night_id and q.bucket = p_bucket for update;

    v_grant := greatest(0, least(v_want, p_night_cap - v_night, p_bucket_cap - v_bucket));

    update public.diag_quota
       set rows_taken = rows_taken + v_grant,
           rows_refused = rows_refused + (v_want - v_grant),
           updated_at = pg_catalog.now()
     where night_id = p_night_id and bucket in ('_night', p_bucket);
    return v_grant;
  exception when lock_not_available then
    return -1;
  end;
end;
$$;

revoke all privileges on function public.diag_take_rows(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.diag_take_rows(uuid, text, integer, integer, integer) to service_role;

-- ─── retention: 45 days ────────────────────────────────────────────────
-- Callable only by trusted server code or an operator. NOTHING in this file
-- schedules it. The app calls it once a day from /api/cron/diag-cleanup (it
-- runs whenever CRON_SECRET is set, whether or not logging is on). It can also
-- be run by hand (see docs/diagnostics/night-timeline.md).
--
-- One call deletes at most p_batch old rows from each table and returns how
-- many it removed. The caller repeats it until it returns 0. Each call is its
-- own transaction, so after a flood the cleanup still makes progress even if a
-- single run is cut short (one giant delete would be rolled back and never
-- finish). The old one-argument version is dropped first so a database that
-- already has it does not end up with two.
drop function if exists public.cleanup_diagnostic_logs(integer);

create or replace function public.cleanup_diagnostic_logs(
  p_days integer default 45,
  p_batch integer default 5000
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_total bigint := 0;
  v_rows bigint;
begin
  -- A typo like cleanup_diagnostic_logs(0) must not wipe a live night.
  if p_days is null or p_days < 7 then
    raise exception 'cleanup_diagnostic_logs: keep at least 7 days';
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 50000 then
    raise exception 'cleanup_diagnostic_logs: batch must be 1 to 50000';
  end if;
  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(days => p_days);

  delete from public.diag_answer_events
   where id in (select e.id from public.diag_answer_events e where e.created_at < v_cutoff limit p_batch);
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  delete from public.diag_server_actions
   where id in (select e.id from public.diag_server_actions e where e.created_at < v_cutoff limit p_batch);
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  delete from public.diag_device_events
   where id in (select e.id from public.diag_device_events e where e.created_at < v_cutoff limit p_batch);
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  delete from public.diag_quota q
   where (q.night_id, q.bucket) in (
     select o.night_id, o.bucket from public.diag_quota o where o.updated_at < v_cutoff limit p_batch
   );
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  return v_total;
end;
$$;

revoke all privileges on function public.cleanup_diagnostic_logs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_diagnostic_logs(integer, integer) to service_role;

-- ─── the night timeline ────────────────────────────────────────────────
-- Everything for one night in one list, ordered by time. Call it:
--   select * from public.diag_night_timeline('<night id>');
--   select * from public.diag_night_timeline('<night id>', '<from>', '<to>');
-- Sources: answer (every tap), action (host presses + timer-end resolves),
-- device:<surface> (phone/TV/host reports), db_reveal (the reveals table),
-- db_answer (answers the database actually saved).
--
-- Every branch is filtered to the one night (and time window) first, so it
-- reads only that night's rows. It still reads real game tables, so do not
-- run it during a show.
--
-- SECURITY INVOKER: it obeys the caller's table rights, so the no-policy RLS
-- above still locks it for the browser roles (and they also have no execute
-- right). The body is a plain string (not BEGIN ATOMIC) on purpose: see the
-- note at the top about not blocking changes to other tables.
drop view if exists public.diag_night_timeline;

create or replace function public.diag_night_timeline(
  p_night_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  night_id uuid,
  at timestamptz,
  source text,
  who text,
  what text,
  detail jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from (
    select
      a.night_id::uuid as night_id,
      a.received_at::timestamptz as at,
      'answer'::text as source,
      coalesce(p.display_name, 'device ' || left(a.device_id::text, 8))::text as who,
      (a.outcome || ': ' || a.reason)::text as what,
      jsonb_strip_nulls(jsonb_build_object(
        'question_id', a.question_id,
        'status', a.http_status,
        'ms_after_open', a.ms_after_open,
        'deadline_s', a.deadline_s,
        'tap_held_ms', case
          when a.client_sent_at is not null and a.client_tap_at is not null
          then (extract(epoch from (a.client_sent_at - a.client_tap_at)) * 1000)::bigint end,
        'client_attempt', a.client_attempt,
        'total_ms', a.total_ms,
        'steps', a.steps,
        'cold_start', a.cold_start,
        'region', a.region
      ))::jsonb as detail
    from public.diag_answer_events a
    left join public.players p
      on p.night_id = a.night_id and p.device_id = a.device_id
    where a.night_id = p_night_id
      and (p_from is null or a.received_at >= p_from)
      and (p_to is null or a.received_at <= p_to)

    union all

    select
      s.night_id::uuid,
      s.received_at::timestamptz,
      'action'::text,
      s.actor::text,
      (s.action || ': ' || s.outcome)::text,
      jsonb_strip_nulls(jsonb_build_object(
        'question_id', s.question_id,
        'status', s.http_status,
        'reason', s.reason,
        'total_ms', s.total_ms,
        'auth_ms', s.auth_ms,
        'db_done_ms', s.db_done_ms,
        'broadcast_start_ms', s.broadcast_start_ms,
        'broadcast_done_ms', s.broadcast_done_ms,
        'broadcast_ok', s.broadcast_ok,
        'broadcast_error', s.broadcast_error,
        'steps', s.steps,
        'cold_start', s.cold_start,
        'region', s.region
      ))::jsonb
    from public.diag_server_actions s
    where s.night_id = p_night_id
      and (p_from is null or s.received_at >= p_from)
      and (p_to is null or s.received_at <= p_to)

    union all

    select
      d.night_id::uuid,
      d.at_est::timestamptz,
      ('device:' || d.surface)::text,
      coalesce(p.display_name, d.surface || ' ' || left(d.session_id, 6))::text,
      (d.kind || coalesce(': ' || (d.data ->> 'ev'), ''))::text,
      (d.data || jsonb_build_object('forced', d.forced, 'offset_ms', d.offset_ms))::jsonb
    from public.diag_device_events d
    left join public.players p
      on p.night_id = d.night_id and p.device_id = d.device_id
    where d.night_id = p_night_id
      and (p_from is null or d.at_est >= p_from)
      and (p_to is null or d.at_est <= p_to)

    union all

    select
      g.night_id::uuid,
      r.occurred_at::timestamptz,
      'db_reveal'::text,
      'database'::text,
      r.event::text,
      jsonb_build_object('question_id', r.question_id)::jsonb
    from public.reveals r
    join public.games g on g.id = r.game_id
    where g.night_id = p_night_id
      and (p_from is null or r.occurred_at >= p_from)
      and (p_to is null or r.occurred_at <= p_to)

    union all

    -- (Legacy engine only. Nights on the resilient engine keep their saved
    -- answers in question_play_answers; they show here as 'answer' lines with
    -- outcome saved. See docs/diagnostics/night-timeline.md.)
    select
      g.night_id::uuid,
      ans.locked_at::timestamptz,
      'db_answer'::text,
      p.display_name::text,
      'saved answer'::text,
      jsonb_build_object('question_id', ans.question_id, 'ms_to_lock', ans.ms_to_lock)::jsonb
    from public.answers ans
    join public.players p on p.id = ans.player_id
    join public.questions q on q.id = ans.question_id
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
    where g.night_id = p_night_id
      and (p_from is null or ans.locked_at >= p_from)
      and (p_to is null or ans.locked_at <= p_to)
  ) timeline
  order by 2
$$;

comment on function public.diag_night_timeline(uuid, timestamptz, timestamptz) is
  'Read-only: diagnostic rows plus the reveals and answers tables for one night, ordered by time. Service role only. Do not run during a show.';

revoke all privileges on function public.diag_night_timeline(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.diag_night_timeline(uuid, timestamptz, timestamptz) to service_role;

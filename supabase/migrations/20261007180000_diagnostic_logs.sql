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
--   diag_night_timeline a read-only view that lines all of it up by time for
--                       one night (see docs/diagnostics/night-timeline.md).
--
-- Rules:
--   - Written ONLY by the server with the service-role key, and only when
--     the DIAGNOSTIC_LOGGING env flag is "on" (off by default in code).
--   - RLS is on with NO policies, and anon/authenticated have no grants, so
--     a browser can never read or write any of it.
--   - No foreign keys on purpose: a turned-down tap can carry ids the
--     database has never seen, and a reset must not wipe the evidence.
--   - Personal data is limited to the device id already stored on `players`
--     and (device events only) a short user-agent description. Display names
--     are NOT copied here; the timeline view joins them from `players`.
--   - Retention: 45 days. cleanup_diagnostic_logs() deletes older rows.
--     Nothing in this migration schedules it. See the docs file for the
--     one-line pg_cron job or the manual query.

set search_path = public, extensions;

-- ─── every answer tap ──────────────────────────────────────────────────
create table public.diag_answer_events (
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

create index diag_answer_events_night_time_idx
  on public.diag_answer_events (night_id, received_at);
create index diag_answer_events_question_time_idx
  on public.diag_answer_events (question_id, received_at);
create index diag_answer_events_created_idx
  on public.diag_answer_events (created_at);

-- ─── host control presses and timer-end resolves ───────────────────────
create table public.diag_server_actions (
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

create index diag_server_actions_night_time_idx
  on public.diag_server_actions (night_id, received_at);
create index diag_server_actions_question_time_idx
  on public.diag_server_actions (question_id, received_at);
create index diag_server_actions_created_idx
  on public.diag_server_actions (created_at);

-- ─── reports from phones, the TV and the host laptop ───────────────────
create table public.diag_device_events (
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

create index diag_device_events_night_time_idx
  on public.diag_device_events (night_id, at_est);
create index diag_device_events_device_time_idx
  on public.diag_device_events (night_id, device_id, at_est);
create index diag_device_events_created_idx
  on public.diag_device_events (created_at);

-- ─── lock it down ──────────────────────────────────────────────────────
-- Supabase's default privileges hand new public tables to the browser
-- roles; take them back. RLS on with no policies is the second lock.
alter table public.diag_answer_events enable row level security;
alter table public.diag_server_actions enable row level security;
alter table public.diag_device_events enable row level security;

revoke all privileges on table public.diag_answer_events from public, anon, authenticated;
revoke all privileges on table public.diag_server_actions from public, anon, authenticated;
revoke all privileges on table public.diag_device_events from public, anon, authenticated;

grant select, insert, delete on table public.diag_answer_events to service_role;
grant select, insert, delete on table public.diag_server_actions to service_role;
grant select, insert, delete on table public.diag_device_events to service_role;

-- ─── retention: 45 days ────────────────────────────────────────────────
-- Callable only by trusted server code or an operator. NOTHING schedules it
-- here. To run it automatically, see docs/diagnostics/night-timeline.md.
create function public.cleanup_diagnostic_logs(p_days integer default 45)
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
  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(days => p_days);

  delete from public.diag_answer_events where created_at < v_cutoff;
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  delete from public.diag_server_actions where created_at < v_cutoff;
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  delete from public.diag_device_events where created_at < v_cutoff;
  get diagnostics v_rows = row_count;
  v_total := v_total + v_rows;

  return v_total;
end;
$$;

revoke all privileges on function public.cleanup_diagnostic_logs(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_diagnostic_logs(integer) to service_role;

-- ─── the night timeline ────────────────────────────────────────────────
-- Everything for one night in one list, ordered by `at`. Filter it:
--   select * from diag_night_timeline
--    where night_id = '...' and at between '...' and '...' order by at;
-- Sources: answer (every tap), action (host presses + timer-end resolves),
-- device:<surface> (phone/TV/host reports), db_reveal (the reveals table),
-- db_answer (answers the database actually saved).
--
-- security_invoker makes the view obey the caller's table rights, so the
-- no-policy RLS above still locks it for the browser roles.
create view public.diag_night_timeline
with (security_invoker = true)
as
  select
    a.night_id,
    a.received_at as at,
    'answer'::text as source,
    coalesce(p.display_name, 'device ' || left(a.device_id::text, 8)) as who,
    a.outcome || ': ' || a.reason as what,
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
    )) as detail
  from public.diag_answer_events a
  left join public.players p
    on p.night_id = a.night_id and p.device_id = a.device_id

  union all

  select
    s.night_id,
    s.received_at,
    'action',
    s.actor,
    s.action || ': ' || s.outcome,
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
    ))
  from public.diag_server_actions s

  union all

  select
    d.night_id,
    d.at_est,
    'device:' || d.surface,
    coalesce(p.display_name, d.surface || ' ' || left(d.session_id, 6)),
    d.kind || coalesce(': ' || (d.data ->> 'ev'), ''),
    d.data || jsonb_build_object('forced', d.forced, 'offset_ms', d.offset_ms)
  from public.diag_device_events d
  left join public.players p
    on p.night_id = d.night_id and p.device_id = d.device_id

  union all

  select
    g.night_id,
    r.occurred_at,
    'db_reveal',
    'database',
    r.event,
    jsonb_build_object('question_id', r.question_id)
  from public.reveals r
  join public.games g on g.id = r.game_id

  union all

  select
    g.night_id,
    ans.locked_at,
    'db_answer',
    p.display_name,
    'saved answer',
    jsonb_build_object('question_id', ans.question_id, 'ms_to_lock', ans.ms_to_lock)
  from public.answers ans
  join public.players p on p.id = ans.player_id
  join public.questions q on q.id = ans.question_id
  join public.categories c on c.id = q.category_id
  join public.games g on g.id = c.game_id;

comment on view public.diag_night_timeline is
  'Read-only: diagnostic rows plus the reveals and answers tables for one night, ordered by `at`. Service role only.';

revoke all privileges on table public.diag_night_timeline from public, anon, authenticated;
grant select on table public.diag_night_timeline to service_role;

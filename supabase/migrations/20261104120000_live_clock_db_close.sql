-- Candidate 2, Database Clock. A job closes overdue legacy questions whether or
-- not any device is talking. Timers only: all-answered stays with the host hook.
--
-- PROTOTYPE: the seed row below turns the sweep on. A live migration seeds 'off'
-- (the column default), runs a show in shadow, and goes on only after the
-- reply-drop harness passes.
--
-- Rollback order is hard. Mode off, then Vercel rollback, then unschedule, then
-- drop functions. Any other order silently loses the reveal broadcast on a
-- sweep close.
--     update public.live_clock set mode = 'off';
--     select cron.unschedule(j) from unnest(array['tr1via-close-due',
--       'tr1via-close-due-gate', 'tr1via-cron-history-trim']) j;
--     drop function public.close_due_questions(), public.claim_close_broadcasts(),
--       public.live_clock_cron_gate(), public.live_clock_preshow_check(text);

create table if not exists public.live_clock (
  id boolean primary key default true check (id),
  mode text not null default 'off' check (mode in ('off', 'shadow', 'on')),
  only_night_id uuid,
  grace_ms integer not null default 1000 check (grace_ms between 0 and 5000),
  last_tick_at timestamptz,
  last_gate_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.live_clock (id, mode) values (true, 'on') on conflict do nothing;

create table if not exists public.question_close_events (
  id bigint generated always as identity primary key,
  question_id uuid not null,
  night_id uuid not null,
  room_code text not null,
  correct_index smallint not null,
  played_at timestamptz not null,
  shadow boolean not null default false,
  closed_at timestamptz not null default now(),
  commit_at timestamptz,
  claimed_at timestamptz,
  claim_count smallint not null default 0,
  sent_at timestamptz,
  sent_via text,
  dropped_at timestamptz,
  drop_reason text check (drop_reason in ('question_changed', 'expired'))
);
create unique index if not exists question_close_events_shadow_once
  on public.question_close_events (question_id, played_at) where shadow;
create index if not exists question_close_events_unsent
  on public.question_close_events (closed_at)
  where sent_at is null and dropped_at is null and not shadow;
create index if not exists questions_open_clock_idx
  on public.questions (played_at) where played_at is not null and finished_at is null;

-- Row-level security on with no policies: only service_role, which bypasses it,
-- and the definer functions below can reach these tables.
alter table public.live_clock enable row level security;
alter table public.question_close_events enable row level security;
revoke all on public.live_clock, public.question_close_events from anon, authenticated;
grant select, update on public.live_clock to service_role;
grant select, update on public.question_close_events to service_role;

-- One tick is one transaction, so nothing here may wait long. The advisory lock
-- comes before the tick stamp: an overlapping tick leaves at once instead of
-- queueing on the live_clock row.
create or replace function public.close_due_questions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.live_clock%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_due_by timestamptz;
  v_locked uuid;
  v_closed integer := 0;
  r record;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(7241001) then
    return 0;
  end if;
  update public.live_clock set last_tick_at = pg_catalog.clock_timestamp()
   where id returning * into v_cfg;
  if not found or v_cfg.mode = 'off' then
    return 0;
  end if;
  set local lock_timeout = '500ms';
  v_due_by := v_now - interval '25 seconds' - v_cfg.grace_ms * interval '1 millisecond';

  for r in
    select q.id, q.played_at, q.correct_index, g.night_id, n.room_code
      from public.questions q
      join public.categories c on c.id = q.category_id
      join public.games g on g.id = c.game_id
      join public.nights n on n.id = g.night_id
     where q.played_at is not null
       and q.finished_at is null
       and q.played_at > v_now - interval '10 minutes'
       and q.played_at <= v_due_by
       and g.state = 'live'
       and n.answer_engine = 'legacy'
       and (v_cfg.only_night_id is null or n.id = v_cfg.only_night_id)
     order by q.played_at
     limit 20
  loop
    begin
      if v_cfg.mode = 'shadow' then
        insert into public.question_close_events
          (question_id, night_id, room_code, correct_index, played_at, shadow, closed_at)
        values (r.id, r.night_id, r.room_code, r.correct_index, r.played_at, true,
                pg_catalog.clock_timestamp())
        on conflict do nothing;
        continue;
      end if;

      -- A busy row waits for the next tick instead of holding every other room.
      select q.id into v_locked
        from public.questions q
       where q.id = r.id and q.finished_at is null and q.played_at = r.played_at
       for update skip locked;
      continue when not found;

      perform public.resolve_question(r.id);

      -- commit_at, because finished_at is the transaction start and hides a late commit.
      insert into public.question_close_events
        (question_id, night_id, room_code, correct_index, played_at, commit_at)
      values (r.id, r.night_id, r.room_code, r.correct_index, r.played_at,
              pg_catalog.clock_timestamp());
      v_closed := v_closed + 1;
    exception when others then
      raise warning 'close_due_questions % failed: % %', r.id, sqlstate, sqlerrm;
    end;
  end loop;
  return v_closed;
end;
$$;

-- Hands out closes still worth announcing. A reset or undo after the close drops
-- the row. So does the 60-second budget: past that the phones' own refresh has
-- already caught up. The 3-second lease lets a refused send go round again.
create or replace function public.claim_close_broadcasts()
returns setof public.question_close_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_give_up record;
begin
  update public.question_close_events e
     set dropped_at = v_now, drop_reason = 'question_changed'
   where e.id in (
     select x.id
       from public.question_close_events x
       left join public.questions q on q.id = x.question_id
      where x.sent_at is null and x.dropped_at is null and not x.shadow
        and (q.finished_at is null or q.played_at is distinct from x.played_at)
      for update of x skip locked);

  for v_give_up in
    update public.question_close_events e
       set dropped_at = v_now, drop_reason = 'expired'
     where e.id in (
       select x.id from public.question_close_events x
        where x.sent_at is null and x.dropped_at is null and not x.shadow
          and x.closed_at <= v_now - interval '60 seconds'
        for update skip locked)
    returning e.question_id, e.room_code, e.claim_count
  loop
    raise warning 'close broadcast gave up: question % room % after % claims',
      v_give_up.question_id, v_give_up.room_code, v_give_up.claim_count;
  end loop;

  return query
  update public.question_close_events e
     set claimed_at = v_now, claim_count = e.claim_count + 1
   where e.id in (
     select x.id from public.question_close_events x
      where x.sent_at is null and x.dropped_at is null and not x.shadow
        and (x.claimed_at is null or x.claimed_at <= v_now - interval '3 seconds')
      order by x.closed_at
      limit 3
      for update skip locked)
  returning e.*;
end;
$$;

-- Runs once a minute. Keeps the 1-second job on only while a legacy game is live,
-- which avoids about 605,000 idle runs a week. Does nothing without pg_cron.
create or replace function public.live_clock_cron_gate()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_want boolean;
  v_job bigint;
  v_active boolean;
begin
  update public.live_clock set last_gate_at = pg_catalog.clock_timestamp()
   where id returning mode into v_mode;
  if pg_catalog.to_regnamespace('cron') is null then
    return;
  end if;
  v_want := v_mode is distinct from 'off' and exists (
    select 1 from public.games g join public.nights n on n.id = g.night_id
     where g.state = 'live' and n.answer_engine = 'legacy');
  select j.jobid, j.active into v_job, v_active
    from cron.job j where j.jobname = 'tr1via-close-due';
  if v_job is not null and v_active is distinct from v_want then
    perform cron.alter_job(job_id := v_job, active := v_want);
  end if;
end;
$$;

-- The pre-show check, read-only. With a game live the sweep must have ticked in
-- the last 5 seconds. With none live the 1-second job is rightly off, so the
-- one-minute gate must have run instead.
create or replace function public.live_clock_preshow_check(p_expected_mode text default 'on')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.live_clock%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_live integer;
  v_unsent integer;
  v_ticking boolean;
  v_problems text[] := '{}';
begin
  select * into v_cfg from public.live_clock where id;
  select pg_catalog.count(*)::integer into v_live
    from public.games g join public.nights n on n.id = g.night_id
   where g.state = 'live' and n.answer_engine = 'legacy';
  select pg_catalog.count(*)::integer into v_unsent
    from public.question_close_events e
   where e.sent_at is null and e.dropped_at is null and not e.shadow;
  v_ticking := case when v_live > 0
    then coalesce(v_cfg.last_tick_at > v_now - interval '5 seconds', false)
    else coalesce(v_cfg.last_gate_at > v_now - interval '2 minutes', false) end;

  if v_cfg.mode is distinct from p_expected_mode then
    v_problems := v_problems || pg_catalog.format('mode is %s, expected %s', v_cfg.mode, p_expected_mode);
  end if;
  if v_cfg.only_night_id is not null then
    v_problems := v_problems || 'only_night_id is set'::text;
  end if;
  if not v_ticking then
    v_problems := v_problems || 'job is not ticking'::text;
  end if;
  if v_unsent > 0 then
    v_problems := v_problems || pg_catalog.format('%s unsent close rows', v_unsent);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', pg_catalog.cardinality(v_problems) = 0,
    'problems', pg_catalog.to_jsonb(v_problems),
    'mode', v_cfg.mode,
    'onlyNightId', v_cfg.only_night_id,
    'liveGames', v_live,
    'unsent', v_unsent,
    'lastTickAt', v_cfg.last_tick_at,
    'lastGateAt', v_cfg.last_gate_at);
end;
$$;

revoke all on function public.close_due_questions() from public, anon, authenticated;
revoke all on function public.claim_close_broadcasts() from public, anon, authenticated;
revoke all on function public.live_clock_cron_gate() from public, anon, authenticated;
revoke all on function public.live_clock_preshow_check(text) from public, anon, authenticated;
grant execute on function public.claim_close_broadcasts() to service_role;
grant execute on function public.live_clock_preshow_check(text) to service_role;

-- The rig and the test database have no pg_cron, so they skip this block and use
-- a 1-second loop instead. The 1-second job starts off; the gate turns it on.
do $$
begin
  if pg_catalog.to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed; close_due_questions is not scheduled';
    return;
  end if;
  perform cron.schedule('tr1via-close-due', '1 second', 'select public.close_due_questions()');
  perform cron.alter_job(
    job_id := (select j.jobid from cron.job j where j.jobname = 'tr1via-close-due'),
    active := false);
  perform cron.schedule('tr1via-close-due-gate', '* * * * *', 'select public.live_clock_cron_gate()');
  perform cron.schedule('tr1via-cron-history-trim', '23 9 * * *',
    $trim$delete from cron.job_run_details where end_time < now() - interval '1 day'$trim$);
end;
$$;

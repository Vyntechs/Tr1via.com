-- 0025_reset_night_answer_engine.sql
--
-- An authoritative reset retires the current run without discarding its
-- command audit. Receipt ancestry moves from the mutable `nights.current_run`
-- identity to immutable run history; receipts that reference play rows are
-- archived before the play graph is cleared. Exact retries consult both the
-- active and archived ledgers.

set search_path = public, extensions;

create table public.live_night_runs (
  night_id uuid not null references public.nights(id) on delete cascade,
  run_id uuid not null,
  answer_engine text not null check (answer_engine in ('legacy', 'resilient_v1')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (night_id, run_id),
  unique (run_id),
  constraint live_night_runs_chronology_valid
    check (ended_at is null or ended_at >= started_at)
);

insert into public.live_night_runs (night_id, run_id, answer_engine, started_at)
select id, current_run_id, answer_engine,
       coalesce(answer_engine_latched_at, opened_at, created_at)
  from public.nights
 where current_run_id is not null
on conflict (night_id, run_id) do nothing;

create or replace function public._record_live_night_run()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.current_run_id is not null
     and old.current_run_id is distinct from new.current_run_id then
    update public.live_night_runs
       set ended_at = coalesce(ended_at, clock_timestamp())
     where night_id = old.id and run_id = old.current_run_id;
  end if;

  if new.current_run_id is not null
     and (tg_op = 'INSERT' or old.current_run_id is distinct from new.current_run_id) then
    insert into public.live_night_runs (
      night_id, run_id, answer_engine, started_at
    ) values (
      new.id, new.current_run_id, new.answer_engine, clock_timestamp()
    ) on conflict (night_id, run_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger nights_record_live_run
after insert or update of current_run_id on public.nights
for each row execute function public._record_live_night_run();

alter table public.live_command_receipts
  drop constraint live_command_receipts_night_run_fk;

alter table public.live_command_receipts
  add constraint live_command_receipts_night_run_fk
    foreign key (night_id, run_id)
    references public.live_night_runs(night_id, run_id)
    on delete cascade;

-- A rejected pre-open command may legitimately have a null run_id, so the
-- composite run FK alone cannot own its deletion. This direct night ancestry
-- keeps both null-run and run-bound receipts on the established night cascade.
alter table public.live_command_receipts
  add constraint live_command_receipts_night_fk
    foreign key (night_id)
    references public.nights(id)
    on delete cascade;

create table public.live_command_receipt_archive (
  night_id uuid not null references public.nights(id) on delete cascade,
  command_id uuid not null,
  run_id uuid,
  kind text not null,
  request_hash text not null,
  expected_control_revision bigint not null,
  expected_game_id uuid,
  expected_play_id uuid,
  expected_play_status text,
  status text not null check (status in ('applied', 'rejected')),
  canonical_result jsonb not null,
  created_at timestamptz not null,
  completed_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (night_id, command_id),
  constraint live_command_receipt_archive_revision_nonnegative
    check (expected_control_revision >= 0),
  constraint live_command_receipt_archive_run_fk
    foreign key (night_id, run_id)
    references public.live_night_runs(night_id, run_id)
    on delete cascade
);

create index live_command_receipt_archive_run_idx
  on public.live_command_receipt_archive (night_id, run_id, archived_at desc);

alter table public.live_night_runs enable row level security;
alter table public.live_command_receipt_archive enable row level security;

revoke all privileges on table
  public.live_night_runs,
  public.live_command_receipt_archive
from public, anon, authenticated;

-- Application code never reads these ledgers directly. SECURITY DEFINER
-- functions owned by the migration role perform the controlled writes and
-- exact-retry reads, so even service_role receives no table mutation surface.
revoke all privileges on table
  public.live_night_runs,
  public.live_command_receipt_archive
from service_role;

create or replace function public._live_existing_command_result(
  p_night_id uuid,
  p_command_id uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_hash text;
  v_status text;
  v_result jsonb;
begin
  select request_hash, status, canonical_result
    into v_request_hash, v_status, v_result
    from public.live_command_receipts
   where night_id = p_night_id
     and command_id = p_command_id
   for update;

  if not found then
    select request_hash, status, canonical_result
      into v_request_hash, v_status, v_result
      from public.live_command_receipt_archive
     where night_id = p_night_id
       and command_id = p_command_id;
  end if;

  if not found then
    return null;
  end if;
  if v_request_hash <> p_request_hash then
    return jsonb_build_object('code', 'stale', 'applied', false);
  end if;
  if v_status = 'pending' then
    return jsonb_build_object('code', 'retry_later', 'retryAfterMs', 100);
  end if;
  return v_result;
end;
$$;

create or replace function public._live_claim_command(
  p_night_id uuid,
  p_command_id uuid,
  p_receipt_run_id uuid,
  p_kind text,
  p_request_hash text,
  p_expected_control_revision bigint,
  p_expected_game_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing jsonb;
  v_rows integer;
begin
  v_existing := public._live_existing_command_result(
    p_night_id, p_command_id, p_request_hash
  );
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.live_command_receipts (
    night_id, command_id, run_id, kind, request_hash,
    expected_control_revision, expected_game_id
  ) values (
    p_night_id, p_command_id, p_receipt_run_id, p_kind, p_request_hash,
    p_expected_control_revision, p_expected_game_id
  ) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return jsonb_build_object('claimed', true);
  end if;
  return public._live_existing_command_result(
    p_night_id, p_command_id, p_request_hash
  );
end;
$$;

-- A reset preallocates its replacement run so the durable night_reset event
-- and the subsequent open belong to one revision stream. Brand-new nights
-- still create their first run here when current_run_id is null.
create or replace function public.open_night_run(
  p_night_id uuid,
  p_command_id uuid,
  p_expected_run_id uuid,
  p_expected_control_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_night public.nights%rowtype;
  v_hash text := md5(concat_ws('|', 'open_night_run', p_night_id::text,
    coalesce(p_expected_run_id::text, 'null'), p_expected_control_revision::text));
  v_claim jsonb;
  v_receipt_run_id uuid;
  v_run_id uuid;
  v_result jsonb;
begin
  select current_run_id into v_receipt_run_id
    from public.nights where id = p_night_id;
  if not found then
    return jsonb_build_object('code', 'not_found', 'applied', false);
  end if;

  v_claim := public._live_claim_command(
    p_night_id, p_command_id, v_receipt_run_id, 'open_night_run', v_hash,
    p_expected_control_revision, null
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return v_claim;
  end if;

  select * into v_night
    from public.nights
   where id = p_night_id
   for update;

  if v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_expected_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(p_night_id, p_command_id, 'stale');
  end if;

  v_run_id := coalesce(v_night.current_run_id, gen_random_uuid());
  update public.nights
     set current_run_id = v_run_id,
         answer_engine_latched_at = coalesce(answer_engine_latched_at, clock_timestamp()),
         opened_at = coalesce(opened_at, clock_timestamp()),
         room_revision = room_revision + 1,
         control_revision = control_revision + 1
   where id = p_night_id
   returning * into v_night;

  insert into public.live_room_events (
    night_id, run_id, room_revision, control_revision, kind, payload
  ) values (
    p_night_id, v_run_id, v_night.room_revision, v_night.control_revision,
    'night_opened', jsonb_build_object('status', 'open')
  );

  v_result := jsonb_build_object(
    'code', 'applied', 'applied', true, 'runId', v_run_id,
    'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set run_id = v_run_id,
         status = 'applied',
         canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = p_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

create or replace function public.reset_live_night_to_setup(
  p_night_id uuid,
  p_run_id uuid,
  p_command_id uuid,
  p_expected_control_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_night public.nights%rowtype;
  v_receipt_run_id uuid;
  v_new_run_id uuid := gen_random_uuid();
  v_hash text := md5(concat_ws('|', 'reset_live_night_to_setup',
    p_night_id::text, p_run_id::text, p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
begin
  select current_run_id into v_receipt_run_id
    from public.nights where id = p_night_id;
  if not found then
    return jsonb_build_object('code', 'not_found', 'applied', false);
  end if;

  v_claim := public._live_claim_command(
    p_night_id, p_command_id, v_receipt_run_id,
    'reset_live_night_to_setup', v_hash,
    p_expected_control_revision, null
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return v_claim;
  end if;

  select * into v_night
    from public.nights
   where id = p_night_id
   for update;

  if v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(p_night_id, p_command_id, 'stale');
  end if;

  perform 1
    from public.games
   where night_id = p_night_id
   order by id
   for update;

  perform 1
    from public.question_plays
   where night_id = p_night_id and run_id = p_run_id
   order by game_id, id
   for update;

  insert into public.live_command_receipt_archive (
    night_id, command_id, run_id, kind, request_hash,
    expected_control_revision, expected_game_id, expected_play_id,
    expected_play_status, status, canonical_result, created_at,
    completed_at, archived_at
  )
  select
    night_id, command_id, run_id, kind, request_hash,
    expected_control_revision, expected_game_id, expected_play_id,
    expected_play_status,
    case when status = 'pending' then 'rejected' else status end,
    case when status = 'pending'
      then jsonb_build_object('code', 'stale', 'applied', false)
      else canonical_result
    end,
    created_at, coalesce(completed_at, clock_timestamp()), clock_timestamp()
  from public.live_command_receipts
  where night_id = p_night_id
    and command_id <> p_command_id
  on conflict (night_id, command_id) do nothing;

  delete from public.live_command_receipts
   where night_id = p_night_id
     and command_id <> p_command_id;

  delete from public.live_room_events
   where night_id = p_night_id;

  delete from public.question_plays
   where night_id = p_night_id;

  delete from public.answers a
  using public.questions q, public.categories c, public.games g
  where a.question_id = q.id
    and q.category_id = c.id
    and c.game_id = g.id
    and g.night_id = p_night_id;

  delete from public.reveals r
  using public.games g
  where r.game_id = g.id
    and g.night_id = p_night_id;

  delete from public.adjustments a
  using public.games g
  where a.game_id = g.id
    and g.night_id = p_night_id;

  update public.questions q
     set played_at = null,
         finished_at = null
    from public.categories c, public.games g
   where q.category_id = c.id
     and c.game_id = g.id
     and g.night_id = p_night_id;

  update public.games
     set state = case when state in ('live', 'done') then 'ready' else state end,
         started_at = null,
         ended_at = null
   where night_id = p_night_id;

  update public.nights
     set current_run_id = v_new_run_id,
         room_revision = 0,
         control_revision = 0,
         opened_at = null
   where id = p_night_id
   returning * into v_night;

  insert into public.live_room_events (
    night_id, run_id, room_revision, control_revision, kind, payload
  ) values (
    p_night_id, v_new_run_id, 0, 0, 'night_reset',
    jsonb_build_object('status', 'setup')
  );

  v_result := jsonb_build_object(
    'code', 'applied',
    'applied', true,
    'previousRunId', p_run_id,
    'runId', v_new_run_id,
    'roomRevision', 0,
    'controlRevision', 0
  );

  update public.live_command_receipts
     set status = 'applied',
         canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = p_night_id
     and command_id = p_command_id;

  return v_result;
end;
$$;

revoke all on function public._record_live_night_run() from public, anon, authenticated;
revoke all on function public._live_existing_command_result(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._live_claim_command(uuid, uuid, uuid, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.reset_live_night_to_setup(uuid, uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public._record_live_night_run() to service_role;
grant execute on function public._live_existing_command_result(uuid, uuid, text) to service_role;
grant execute on function public._live_claim_command(uuid, uuid, uuid, text, text, bigint, uuid) to service_role;
grant execute on function public.reset_live_night_to_setup(uuid, uuid, uuid, bigint) to service_role;

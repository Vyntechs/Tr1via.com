-- 0026_atomic_answer_engine_open.sql
--
-- Select and latch the answer engine inside the same locked transaction that
-- opens the night. Routes must never pre-update `nights.answer_engine`: a
-- concurrent host open must observe one durable engine/run decision.

set search_path = public, extensions;

-- Pre-open command receipts have no run yet. The composite foreign key added
-- in 0025 deliberately accepts null while direct night ancestry owns cascade.
alter table public.live_command_receipts
  alter column run_id drop not null;

-- A receipt is deliberately claimed before the night row is locked. Defer
-- direct parent validation so the provisional insert does not acquire a
-- KEY SHARE lock that can deadlock with another opener's later FOR UPDATE.
-- The run ancestry FK stays immediate for every run-bound receipt.
alter table public.live_command_receipts
  drop constraint live_command_receipts_night_fk,
  add constraint live_command_receipts_night_fk
    foreign key (night_id)
    references public.nights(id)
    on delete cascade
    deferrable initially deferred;

-- Lifecycle receipts also name their expected game before the command takes
-- the night/game locks. Defer this ancestry check for the same reason: an
-- immediate game KEY SHARE can deadlock a concurrent command that already
-- holds the night lock and is waiting to lock that game.
alter table public.live_command_receipts
  drop constraint live_command_receipts_game_night_fk,
  add constraint live_command_receipts_game_night_fk
    foreign key (expected_game_id, night_id)
    references public.games(id, night_id)
    deferrable initially deferred;

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
  v_receipt_run_id uuid;
  v_night public.nights%rowtype;
  v_hash text := md5(concat_ws('|', 'open_night_run', p_night_id::text,
    coalesce(p_expected_run_id::text, 'null'), p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
  v_selected_engine text;
  v_release_enabled boolean;
  v_preferred_engine text;
  v_run_id uuid;
begin
  -- Claim before taking the night lock. Exact retries and conflicting command
  -- IDs terminate at the durable receipt instead of repeating mutations.
  select current_run_id into v_receipt_run_id
    from public.nights
   where id = p_night_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_found', 'applied', false)
    );
  end if;

  v_claim := public._live_claim_command(
    p_night_id, p_command_id, v_receipt_run_id, 'open_night_run', v_hash,
    p_expected_control_revision, null
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return public._live_mutation_envelope(false, v_claim);
  end if;

  select * into v_night
    from public.nights
   where id = p_night_id
   for update;

  -- Existing open semantics are idempotent. Do not consult rollout settings,
  -- alter a latch, or advance any revision for an already-open room.
  if v_night.opened_at is not null then
    v_result := jsonb_build_object(
      'code', 'already_open', 'openedAt', v_night.opened_at
    );
    update public.live_command_receipts
       set status = 'rejected', canonical_result = v_result,
           completed_at = clock_timestamp()
     where night_id = p_night_id and command_id = p_command_id;
    return public._live_mutation_envelope(false, v_result);
  end if;

  -- Validate the caller's durable view before the rollout preference can
  -- become a permanent night latch.
  if v_night.current_run_id is distinct from p_expected_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_mutation_envelope(
      false, public._live_reject_command(p_night_id, p_command_id, 'stale')
    );
  end if;

  if v_night.answer_engine_latched_at is not null then
    v_selected_engine := v_night.answer_engine;
  else
    select release_enabled, preferred_engine
      into v_release_enabled, v_preferred_engine
      from public.host_answer_engine_settings
     where host_id = v_night.host_id;
    v_selected_engine := case
      when coalesce(v_release_enabled, false) = true
       and v_preferred_engine = 'resilient_v1'
      then 'resilient_v1'
      else 'legacy'
    end;
  end if;

  if v_selected_engine = 'legacy' then
    update public.nights
       set answer_engine = 'legacy',
           answer_engine_latched_at = coalesce(answer_engine_latched_at, clock_timestamp()),
           opened_at = clock_timestamp()
     where id = p_night_id
     returning * into v_night;
    v_result := jsonb_build_object(
      'code', 'legacy_opened', 'openedAt', v_night.opened_at
    );
    update public.live_command_receipts
       set status = 'rejected', canonical_result = v_result,
           completed_at = clock_timestamp()
     where night_id = p_night_id and command_id = p_command_id;
    return public._live_mutation_envelope(false, v_result);
  end if;

  v_run_id := coalesce(v_night.current_run_id, gen_random_uuid());
  update public.nights
     set answer_engine = 'resilient_v1',
         answer_engine_latched_at = coalesce(answer_engine_latched_at, clock_timestamp()),
         current_run_id = v_run_id,
         opened_at = clock_timestamp(),
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
    'code', 'applied', 'applied', true, 'eventKind', 'night_opened',
    'runId', v_run_id,
    'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set run_id = v_run_id, status = 'applied', canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = p_night_id and command_id = p_command_id;
  return public._live_mutation_envelope(true, v_result);
end;
$$;

revoke all on function public.open_night_run(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.open_night_run(uuid, uuid, uuid, bigint)
  to service_role;

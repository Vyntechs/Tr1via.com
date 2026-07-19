-- 0027_durable_answer_admission_repair.sql
--
-- A browser answer is admitted durably before any aggregate live state is
-- changed. Admission takes only a shared lock on the exact play, authors the
-- receipt timestamp after that gate, and commits independently. Application
-- then follows the canonical night -> game -> play lock order and converts a
-- pending row exactly once. Terminal play operations drain or dispose pending
-- claims while holding those same canonical locks.

set search_path = public, extensions;

-- Player suggestion writes are signed server-route operations. Browser roles
-- retain no direct table mutation path that could forge player ownership.
revoke insert, update, delete on table public.topic_suggestions
  from anon, authenticated;
revoke insert, update, delete on table public.audience_topic_votes
  from anon, authenticated;
drop policy if exists suggestions_player_insert on public.topic_suggestions;
drop policy if exists votes_player_all on public.audience_topic_votes;

create or replace function public._live_apply_pending_answer_locked(
  p_night_id uuid,
  p_run_id uuid,
  p_game_id uuid,
  p_play_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_night public.nights%rowtype;
  v_play public.question_plays%rowtype;
  v_answer public.question_play_answers%rowtype;
  v_latest_receipt timestamptz;
  v_result jsonb;
begin
  select * into v_night
    from public.nights
   where id = p_night_id;
  select * into v_play
    from public.question_plays
   where id = p_play_id
     and night_id = p_night_id
     and run_id = p_run_id
     and game_id = p_game_id;
  if not found
     or v_night.current_run_id is distinct from p_run_id then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'stale')
    );
  end if;

  select * into v_answer
    from public.question_play_answers
   where play_id = p_play_id
     and player_id = p_player_id
   for update;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_eligible')
    );
  end if;
  if v_answer.canonical_result is not null then
    return public._live_mutation_envelope(
      false, v_answer.canonical_result
    );
  end if;
  if v_play.status in ('resolved', 'undone') then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'corrupt_state', 'applied', false)
    );
  end if;

  update public.question_plays
     set confirmed_count = confirmed_count + 1
   where id = p_play_id
   returning * into v_play;

  if v_play.status = 'accepting'
     and v_play.eligible_count > 0
     and v_play.confirmed_count = v_play.eligible_count
     and v_answer.received_at < v_play.main_zero_at then
    select max(received_at) into v_latest_receipt
      from public.question_play_answers
     where play_id = p_play_id;
    update public.question_plays
       set status = 'all_in_hold',
           finalize_at = greatest(
             v_latest_receipt + interval '1200 milliseconds',
             opened_at + interval '2 seconds'
           )
     where id = p_play_id
     returning * into v_play;
  end if;

  update public.nights
     set room_revision = room_revision + 1
   where id = p_night_id
   returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    p_night_id, p_run_id, p_play_id, p_game_id, v_play.question_id,
    v_night.room_revision, v_night.control_revision, 'answer_progress',
    jsonb_build_object(
      'status', v_play.status,
      'eligibleCount', v_play.eligible_count,
      'confirmedCount', v_play.confirmed_count,
      'finalizeAt', v_play.finalize_at
    )
  );
  v_result := jsonb_build_object(
    'code', 'confirmed',
    'confirmedSlot', v_answer.visible_slot,
    'duplicate', false,
    'eventKind', 'answer_progress',
    'runId', p_run_id,
    'gameId', p_game_id,
    'questionId', v_play.question_id,
    'playId', p_play_id,
    'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
  update public.question_play_answers
     set canonical_result = v_result
   where play_id = p_play_id
     and player_id = p_player_id
     and canonical_result is null;
  return public._live_mutation_envelope(true, v_result);
end;
$$;

create or replace function public._live_reconcile_pending_answers_locked(
  p_night_id uuid,
  p_run_id uuid,
  p_game_id uuid,
  p_play_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_player_id uuid;
  v_envelope jsonb;
  v_count integer := 0;
begin
  for v_player_id in
    select player_id
      from public.question_play_answers
     where play_id = p_play_id
       and canonical_result is null
     order by player_id
     for update
  loop
    v_envelope := public._live_apply_pending_answer_locked(
      p_night_id, p_run_id, p_game_id, p_play_id, v_player_id
    );
    if v_envelope->'result'->>'code' <> 'confirmed' then
      raise exception 'pending live answer could not be reconciled';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_question_play_answer(
  p_play_id uuid,
  p_run_id uuid,
  p_verified_device_id uuid,
  p_submission_id uuid,
  p_visible_slot smallint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz;
  v_play public.question_plays%rowtype;
  v_player_id uuid;
  v_answer public.question_play_answers%rowtype;
  v_window public.question_play_attempt_windows%rowtype;
  v_current_run_id uuid;
  v_answer_engine text;
  v_scramble smallint[];
  v_canonical smallint;
  v_retry_ms integer;
  v_rows integer;
begin
  if p_visible_slot not between 1 and 4 then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'invalid_request')
    );
  end if;

  -- This is the admission gate. Terminal writers need an exclusive play lock,
  -- so they wait for this transaction to durably commit or roll back. The
  -- receipt clock is authored only after this exact shared lock is acquired.
  select * into v_play
    from public.question_plays
   where id = p_play_id
   for share;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_eligible')
    );
  end if;
  v_now := clock_timestamp();

  select answer_engine, current_run_id
    into v_answer_engine, v_current_run_id
    from public.nights
   where id = v_play.night_id;
  if not found
     or v_answer_engine <> 'resilient_v1'
     or v_current_run_id is distinct from p_run_id
     or v_play.run_id is distinct from p_run_id then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'stale')
    );
  end if;

  select p.id into v_player_id
    from public.players p
   where p.night_id = v_play.night_id
     and p.device_id = p_verified_device_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'identity_invalid')
    );
  end if;
  if not exists (
    select 1
      from public.question_play_eligibility e
     where e.play_id = p_play_id
       and e.player_id = v_player_id
  ) then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_eligible')
    );
  end if;

  select * into v_answer
    from public.question_play_answers
   where play_id = p_play_id
     and player_id = v_player_id;
  if found then
    return public._live_mutation_envelope(
      false,
      jsonb_build_object(
        'code', 'claimed',
        'duplicate', true,
        'runId', p_run_id,
        'playId', p_play_id
      )
    );
  end if;

  insert into public.question_play_attempt_windows (
    play_id, player_id, window_started_at, attempt_count
  ) values (
    p_play_id, v_player_id, v_now, 0
  ) on conflict do nothing;

  -- The per-player row serializes simultaneous exact/conflicting first claims.
  -- Recheck the durable answer after waiting so the first committed row wins.
  select * into v_window
    from public.question_play_attempt_windows
   where play_id = p_play_id
     and player_id = v_player_id
   for update;
  select * into v_answer
    from public.question_play_answers
   where play_id = p_play_id
     and player_id = v_player_id;
  if found then
    return public._live_mutation_envelope(
      false,
      jsonb_build_object(
        'code', 'claimed',
        'duplicate', true,
        'runId', p_run_id,
        'playId', p_play_id
      )
    );
  end if;

  if v_now >= v_window.window_started_at + interval '10 seconds' then
    update public.question_play_attempt_windows
       set window_started_at = v_now,
           attempt_count = 1
     where play_id = p_play_id
       and player_id = v_player_id;
  elsif v_window.attempt_count >= 10 then
    v_retry_ms := greatest(1, ceil(extract(epoch from (
      v_window.window_started_at + interval '10 seconds' - v_now
    )) * 1000)::integer);
    return public._live_mutation_envelope(
      false,
      jsonb_build_object(
        'code', 'retry_later',
        'retryAfterMs', v_retry_ms
      )
    );
  else
    update public.question_play_attempt_windows
       set attempt_count = attempt_count + 1
     where play_id = p_play_id
       and player_id = v_player_id;
  end if;

  if v_play.status in ('resolved', 'undone')
     or v_now >= v_play.final_window_ends_at then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'deadline_passed')
    );
  end if;

  v_scramble := public._live_scramble_for(v_play.question_id, v_player_id);
  v_canonical := v_scramble[p_visible_slot];
  insert into public.question_play_answers (
    play_id, player_id, submission_id, visible_slot, canonical_index,
    received_at, locked_at, ms_to_lock
  ) values (
    p_play_id, v_player_id, p_submission_id, p_visible_slot, v_canonical,
    v_now, v_now,
    greatest(
      0,
      floor(extract(epoch from (v_now - v_play.opened_at)) * 1000)::integer
    )
  ) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return public._live_mutation_envelope(
      false,
      jsonb_build_object(
        'code', 'claimed',
        'duplicate', true,
        'runId', p_run_id,
        'playId', p_play_id
      )
    );
  end if;

  return public._live_mutation_envelope(
    true,
    jsonb_build_object(
      'code', 'claimed',
      'duplicate', false,
      'runId', p_run_id,
      'playId', p_play_id
    )
  );
end;
$$;

create or replace function public.apply_claimed_question_play_answer(
  p_play_id uuid,
  p_run_id uuid,
  p_verified_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_night public.nights%rowtype;
  v_game public.games%rowtype;
  v_play public.question_plays%rowtype;
  v_player_id uuid;
begin
  select night_id, game_id
    into v_play.night_id, v_play.game_id
    from public.question_plays
   where id = p_play_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_eligible')
    );
  end if;

  select * into v_night
    from public.nights
   where id = v_play.night_id
   for update;
  if not found
     or v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_run_id then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'stale')
    );
  end if;
  select * into v_game
    from public.games
   where id = v_play.game_id
     and night_id = v_night.id
   for update;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'stale')
    );
  end if;
  select * into v_play
    from public.question_plays
   where id = p_play_id
     and night_id = v_night.id
     and run_id = p_run_id
     and game_id = v_game.id
   for update;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'stale')
    );
  end if;
  select p.id into v_player_id
    from public.players p
   where p.night_id = v_night.id
     and p.device_id = p_verified_device_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'identity_invalid')
    );
  end if;
  return public._live_apply_pending_answer_locked(
    v_night.id, p_run_id, v_game.id, p_play_id, v_player_id
  );
end;
$$;

-- Keep the established scoring body intact behind a reconciliation wrapper.
-- Every caller already owns night -> game -> play locks before entering it.
alter function public._live_resolve_locked_play(
  uuid, uuid, uuid, uuid, timestamptz
) rename to _live_resolve_locked_play_after_admission;

create or replace function public._live_resolve_locked_play(
  p_night_id uuid,
  p_run_id uuid,
  p_game_id uuid,
  p_play_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.question_plays
   where id = p_play_id
     and night_id = p_night_id
     and run_id = p_run_id
     and game_id = p_game_id;
  if found and v_status not in ('resolved', 'undone') then
    perform public._live_reconcile_pending_answers_locked(
      p_night_id, p_run_id, p_game_id, p_play_id
    );
  end if;
  return public._live_resolve_locked_play_after_admission(
    p_night_id, p_run_id, p_game_id, p_play_id, p_now
  );
end;
$$;

create or replace function public.start_live_game(
  p_game_id uuid,
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
  v_night_id uuid;
  v_receipt_run_id uuid;
  v_night public.nights%rowtype;
  v_game public.games%rowtype;
  v_ready_category_id uuid;
  v_ready_question_id uuid;
  v_hash text := md5(concat_ws('|', 'start_live_game', p_game_id::text,
    p_run_id::text, p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
begin
  select g.night_id, n.current_run_id
    into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_found', 'applied', false)
    );
  end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id, 'start_live_game', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return public._live_mutation_envelope(false, v_claim);
  end if;

  select * into v_night
    from public.nights
   where id = v_night_id
   for update;
  if v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'stale')
    );
  end if;

  select * into v_game
    from public.games
   where id = p_game_id
     and night_id = v_night_id
   for update;
  if v_game.state <> 'ready' then
    return public._live_mutation_envelope(
      false,
      public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;

  select c.id, q.id
    into v_ready_category_id, v_ready_question_id
    from public.categories c
    join public.questions q on q.category_id = c.id
   where c.game_id = p_game_id
     and c.state = 'ready'
     and q.is_picked = true
     and q.point_value is not null
     and btrim(q.prompt) <> ''
     and jsonb_typeof(q.options) = 'array'
     and jsonb_array_length(q.options) = 4
   order by c.position, q.point_value, q.id
   limit 1
   for key share of c, q;
  if not found then
    return public._live_mutation_envelope(
      false,
      public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;

  update public.games
     set state = 'live',
         started_at = clock_timestamp(),
         ended_at = null
   where id = p_game_id;
  update public.nights
     set room_revision = room_revision + 1,
         control_revision = control_revision + 1
   where id = v_night_id
   returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, game_id, room_revision, control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, p_game_id, v_night.room_revision,
    v_night.control_revision, 'game_started', jsonb_build_object('state', 'live')
  );
  v_result := jsonb_build_object(
    'code', 'applied',
    'applied', true,
    'eventKind', 'game_started',
    'runId', p_run_id,
    'gameId', p_game_id,
    'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set status = 'applied',
         canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = v_night_id
     and command_id = p_command_id;
  return public._live_mutation_envelope(true, v_result);
end;
$$;

create or replace function public.begin_question_play_final_window(
  p_game_id uuid,
  p_play_id uuid,
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
  v_night_id uuid;
  v_receipt_run_id uuid;
  v_night public.nights%rowtype;
  v_game public.games%rowtype;
  v_play public.question_plays%rowtype;
  v_now timestamptz := clock_timestamp();
  v_hash text := md5(concat_ws('|', 'begin_question_play_final_window',
    p_game_id::text, p_play_id::text, p_run_id::text,
    p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
  v_resolution jsonb;
begin
  select g.night_id, n.current_run_id
    into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_found', 'applied', false)
    );
  end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id,
    'begin_question_play_final_window', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return public._live_mutation_envelope(false, v_claim);
  end if;

  select * into v_night
    from public.nights
   where id = v_night_id
   for update;
  if v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'stale')
    );
  end if;
  select * into v_game
    from public.games
   where id = p_game_id
     and night_id = v_night_id
   for update;
  select * into v_play
    from public.question_plays
   where id = p_play_id
     and night_id = v_night_id
     and run_id = p_run_id
     and game_id = p_game_id
   for update;
  if not found then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'stale')
    );
  end if;
  update public.live_command_receipts
     set expected_play_id = p_play_id,
         expected_play_status = v_play.status
   where night_id = v_night_id
     and command_id = p_command_id;
  if v_play.status not in ('accepting', 'all_in_hold') then
    return public._live_mutation_envelope(
      false,
      public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;

  perform public._live_reconcile_pending_answers_locked(
    v_night_id, p_run_id, p_game_id, p_play_id
  );
  select * into v_night
    from public.nights
   where id = v_night_id;
  select * into v_play
    from public.question_plays
   where id = p_play_id;

  if v_now >= v_play.final_window_ends_at then
    v_resolution := public._live_resolve_locked_play(
      v_night_id, p_run_id, p_game_id, p_play_id, v_now
    );
    v_result := v_resolution->'result';
    update public.live_command_receipts
       set status = 'applied',
           canonical_result = v_result,
           completed_at = clock_timestamp()
     where night_id = v_night_id
       and command_id = p_command_id;
    return v_resolution;
  elsif v_now >= v_play.main_zero_at then
    update public.question_plays
       set status = 'final_window',
           final_window_starts_at = main_zero_at,
           finalize_at = final_window_ends_at
     where id = p_play_id
     returning * into v_play;
  else
    update public.question_plays
       set status = 'final_window',
           final_window_starts_at = v_now,
           final_window_ends_at = v_now + interval '2 seconds',
           finalize_at = v_now + interval '2 seconds'
     where id = p_play_id
     returning * into v_play;
  end if;

  update public.nights
     set room_revision = room_revision + 1,
         control_revision = control_revision + 1
   where id = v_night_id
   returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, p_play_id, p_game_id, v_play.question_id,
    v_night.room_revision, v_night.control_revision,
    'final_window_started',
    jsonb_build_object(
      'status', 'final_window',
      'finalWindowEndsAt', v_play.final_window_ends_at
    )
  );
  v_result := jsonb_build_object(
    'code', 'applied',
    'applied', true,
    'eventKind', 'final_window_started',
    'runId', p_run_id,
    'gameId', p_game_id,
    'questionId', v_play.question_id,
    'playId', p_play_id,
    'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set status = 'applied',
         canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = v_night_id
     and command_id = p_command_id;
  return public._live_mutation_envelope(true, v_result);
end;
$$;

create or replace function public.undo_question_play(
  p_game_id uuid,
  p_play_id uuid,
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
  v_now timestamptz := clock_timestamp();
  v_night_id uuid;
  v_receipt_run_id uuid;
  v_night public.nights%rowtype;
  v_game public.games%rowtype;
  v_play public.question_plays%rowtype;
  v_hash text := md5(concat_ws('|', 'undo_question_play', p_game_id::text,
    p_play_id::text, p_run_id::text, p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
begin
  select g.night_id, n.current_run_id
    into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then
    return public._live_mutation_envelope(
      false, jsonb_build_object('code', 'not_found', 'applied', false)
    );
  end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id, 'undo_question_play', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return public._live_mutation_envelope(false, v_claim);
  end if;

  select * into v_night
    from public.nights
   where id = v_night_id
   for update;
  if v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'stale')
    );
  end if;
  select * into v_game
    from public.games
   where id = p_game_id
     and night_id = v_night_id
   for update;
  select * into v_play
    from public.question_plays
   where id = p_play_id
     and night_id = v_night_id
     and run_id = p_run_id
     and game_id = p_game_id
   for update;
  if not found then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'stale')
    );
  end if;
  update public.live_command_receipts
     set expected_play_id = p_play_id,
         expected_play_status = v_play.status
   where night_id = v_night_id
     and command_id = p_command_id;
  if v_play.status in ('resolved', 'undone')
     or not public._live_undo_allowed(v_play.opened_at, v_now) then
    return public._live_mutation_envelope(
      false,
      public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;

  perform public._live_reconcile_pending_answers_locked(
    v_night_id, p_run_id, p_game_id, p_play_id
  );
  select * into v_night
    from public.nights
   where id = v_night_id;
  select * into v_play
    from public.question_plays
   where id = p_play_id;

  update public.question_plays
     set status = 'undone',
         finalize_at = null,
         final_window_starts_at = null,
         resolved_at = null,
         resolution_reason = null
   where id = p_play_id;
  update public.questions
     set played_at = null,
         finished_at = null
   where id = v_play.question_id;
  update public.nights
     set room_revision = room_revision + 1,
         control_revision = control_revision + 1
   where id = v_night_id
   returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, p_play_id, p_game_id, v_play.question_id,
    v_night.room_revision, v_night.control_revision, 'play_undone',
    jsonb_build_object('status', 'undone')
  );
  v_result := jsonb_build_object(
    'code', 'applied',
    'applied', true,
    'eventKind', 'play_undone',
    'runId', p_run_id,
    'gameId', p_game_id,
    'questionId', v_play.question_id,
    'playId', p_play_id,
    'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set status = 'applied',
         canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = v_night_id
     and command_id = p_command_id;
  return public._live_mutation_envelope(true, v_result);
end;
$$;

-- Remove the single-transaction mutation entry point. Only the two durable
-- service-role steps below remain callable by application code.
revoke all on function public.submit_question_play_answer(
  uuid, uuid, uuid, uuid, smallint
) from public, anon, authenticated, service_role;
drop function public.submit_question_play_answer(
  uuid, uuid, uuid, uuid, smallint
);

revoke all on function public._live_apply_pending_answer_locked(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public._live_reconcile_pending_answers_locked(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public._live_resolve_locked_play_after_admission(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public._live_resolve_locked_play(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.claim_question_play_answer(
  uuid, uuid, uuid, uuid, smallint
) from public, anon, authenticated;
revoke all on function public.apply_claimed_question_play_answer(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.start_live_game(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated;

grant execute on function public.claim_question_play_answer(
  uuid, uuid, uuid, uuid, smallint
) to service_role;
grant execute on function public.apply_claimed_question_play_answer(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.start_live_game(
  uuid, uuid, uuid, bigint
) to service_role;

-- 0023_live_answer_engine_functions.sql
--
-- Server-authoritative lifecycle and answer mutations for resilient_v1.
-- All browser-visible inputs are reduced to identities, command revisions,
-- and a visible answer slot; database time and canonical rows decide the rest.

set search_path = public, extensions;

-- A command can be canonically rejected before a run exists (most notably
-- the first open command with a stale control precondition). Applied
-- receipts still require a run and retain the 0022 composite ancestry FK.
alter table public.live_command_receipts
  alter column run_id drop not null;

alter table public.live_command_receipts
  add constraint live_command_receipts_applied_run_required
  check (status <> 'applied' or run_id is not null);

create or replace function public._live_scramble_for(
  p_question_id uuid,
  p_player_id uuid
)
returns smallint[]
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $$
declare
  v_input text := p_question_id::text || ':' || p_player_id::text;
  v_hash bigint := 2166136261;
  v_state bigint;
  v_t bigint;
  v_rand bigint;
  v_i integer;
  v_j integer;
  v_tmp smallint;
  v_result smallint[] := array[0, 1, 2, 3]::smallint[];
begin
  for v_i in 1..length(v_input) loop
    v_hash := ((v_hash # ascii(substr(v_input, v_i, 1))) * 16777619) & 4294967295;
  end loop;

  v_state := v_hash;
  for v_i in reverse 4..2 loop
    v_state := (v_state + 1831565813) & 4294967295;
    v_t := v_state;
    v_t := mod(
      (v_t # (v_t >> 15))::numeric * (v_t | 1)::numeric,
      4294967296::numeric
    )::bigint;
    v_t := (
      v_t # ((v_t + mod(
        (v_t # (v_t >> 7))::numeric * (v_t | 61)::numeric,
        4294967296::numeric
      )::bigint) & 4294967295)
    ) & 4294967295;
    v_rand := (v_t # (v_t >> 14)) & 4294967295;
    v_j := ((v_rand * v_i) / 4294967296)::integer;
    v_tmp := v_result[v_i];
    v_result[v_i] := v_result[v_j + 1];
    v_result[v_j + 1] := v_tmp;
  end loop;
  return v_result;
end;
$$;

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
  v_receipt public.live_command_receipts%rowtype;
begin
  select *
    into v_receipt
    from public.live_command_receipts
   where night_id = p_night_id
     and command_id = p_command_id
   for update;

  if not found then
    return null;
  end if;
  if v_receipt.request_hash <> p_request_hash then
    return jsonb_build_object('code', 'stale', 'applied', false);
  end if;
  if v_receipt.status = 'pending' then
    return jsonb_build_object('code', 'retry_later', 'retryAfterMs', 100);
  end if;
  return v_receipt.canonical_result;
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
  v_rows integer;
begin
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
  return public._live_existing_command_result(p_night_id, p_command_id, p_request_hash);
end;
$$;

create or replace function public._live_reject_command(
  p_night_id uuid,
  p_command_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb := jsonb_build_object('code', p_code, 'applied', false);
begin
  update public.live_command_receipts
     set status = 'rejected', canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = p_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

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
  if not coalesce((v_claim->>'claimed')::boolean, false) then return v_claim; end if;

  select * into v_night from public.nights where id = p_night_id for update;

  if v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_expected_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(p_night_id, p_command_id, 'stale');
  end if;

  v_run_id := gen_random_uuid();
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
     set run_id = v_run_id, status = 'applied', canonical_result = v_result,
         completed_at = clock_timestamp()
   where night_id = p_night_id and command_id = p_command_id;
  return v_result;
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
  v_hash text := md5(concat_ws('|', 'start_live_game', p_game_id::text,
    p_run_id::text, p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
begin
  select g.night_id, n.current_run_id into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then return jsonb_build_object('code', 'not_found', 'applied', false); end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id, 'start_live_game', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then return v_claim; end if;

  select * into v_night from public.nights where id = v_night_id for update;
  if v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(v_night_id, p_command_id, 'stale');
  end if;

  select * into v_game from public.games where id = p_game_id and night_id = v_night_id for update;
  if v_game.state <> 'ready' then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;

  update public.games
     set state = 'live', started_at = clock_timestamp(), ended_at = null
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
    'code', 'applied', 'applied', true, 'runId', p_run_id, 'gameId', p_game_id,
    'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set status = 'applied', canonical_result = v_result, completed_at = clock_timestamp()
   where night_id = v_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

create or replace function public.open_question_play(
  p_game_id uuid,
  p_question_id uuid,
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
  v_question public.questions%rowtype;
  v_category_id uuid;
  v_play_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_eligible integer;
  v_hash text := md5(concat_ws('|', 'open_question_play', p_game_id::text,
    p_question_id::text, p_run_id::text, p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
begin
  select g.night_id, n.current_run_id into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then return jsonb_build_object('code', 'not_found', 'applied', false); end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id, 'open_question_play', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then return v_claim; end if;

  select * into v_night from public.nights where id = v_night_id for update;
  if v_night.answer_engine <> 'resilient_v1'
     or v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(v_night_id, p_command_id, 'stale');
  end if;

  select * into v_game from public.games where id = p_game_id and night_id = v_night_id for update;
  if v_game.state <> 'live' then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;
  select q.*
    into v_question
    from public.questions q
    join public.categories c on c.id = q.category_id
   where q.id = p_question_id and c.game_id = p_game_id
   for update of q;
  if not found or v_question.played_at is not null then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;
  v_category_id := v_question.category_id;
  if exists (
    select 1
      from public.question_plays qp
     where qp.run_id = p_run_id
       and qp.status in ('accepting', 'all_in_hold', 'final_window')
  ) then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;

  insert into public.question_plays (
    id, night_id, run_id, game_id, category_id, question_id, status,
    opened_at, main_zero_at, final_window_ends_at
  ) values (
    v_play_id, v_night_id, p_run_id, p_game_id, v_category_id, p_question_id,
    'accepting', v_now, v_now + interval '30 seconds', v_now + interval '32 seconds'
  );
  insert into public.question_play_eligibility (play_id, player_id, night_id, frozen_at)
  select v_play_id, p.id, v_night_id, v_now
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
   where gp.game_id = p_game_id
     and p.night_id = v_night_id
     and p.removed_at is null
     and p.can_answer = true;
  get diagnostics v_eligible = row_count;
  update public.question_plays set eligible_count = v_eligible where id = v_play_id;
  update public.questions set played_at = v_now where id = p_question_id;
  update public.nights
     set room_revision = room_revision + 1,
         control_revision = control_revision + 1
   where id = v_night_id
   returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, v_play_id, p_game_id, p_question_id,
    v_night.room_revision, v_night.control_revision, 'play_opened',
    jsonb_build_object(
      'status', 'accepting', 'eligibleCount', v_eligible,
      'confirmedCount', 0, 'openedAt', v_now,
      'mainZeroAt', v_now + interval '30 seconds',
      'finalWindowEndsAt', v_now + interval '32 seconds'
    )
  );
  v_result := jsonb_build_object(
    'code', 'applied', 'applied', true, 'runId', p_run_id,
    'gameId', p_game_id, 'playId', v_play_id,
    'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts
     set status = 'applied', canonical_result = v_result, completed_at = clock_timestamp()
   where night_id = v_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

create or replace function public.submit_question_play_answer(
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
  v_now timestamptz := clock_timestamp();
  v_night public.nights%rowtype;
  v_game public.games%rowtype;
  v_play public.question_plays%rowtype;
  v_player_id uuid;
  v_answer public.question_play_answers%rowtype;
  v_window public.question_play_attempt_windows%rowtype;
  v_scramble smallint[];
  v_canonical smallint;
  v_retry_ms integer;
begin
  if p_visible_slot not between 1 and 4 then
    return jsonb_build_object('code', 'invalid_request');
  end if;
  select night_id into v_play.night_id from public.question_plays where id = p_play_id;
  if not found then return jsonb_build_object('code', 'not_eligible'); end if;
  select * into v_night from public.nights where id = v_play.night_id for update;
  select game_id into v_play.game_id from public.question_plays where id = p_play_id;
  select * into v_game from public.games where id = v_play.game_id and night_id = v_night.id for update;
  select * into v_play
    from public.question_plays
   where id = p_play_id and night_id = v_night.id and game_id = v_game.id
   for update;
  if v_night.current_run_id is distinct from p_run_id or v_play.run_id is distinct from p_run_id then
    return jsonb_build_object('code', 'stale');
  end if;

  select p.id into v_player_id
    from public.players p
   where p.night_id = v_night.id and p.device_id = p_verified_device_id;
  if not found then return jsonb_build_object('code', 'identity_invalid'); end if;
  if not exists (
    select 1 from public.question_play_eligibility e
     where e.play_id = p_play_id and e.player_id = v_player_id
  ) then return jsonb_build_object('code', 'not_eligible'); end if;

  select * into v_answer
    from public.question_play_answers
   where play_id = p_play_id and player_id = v_player_id;
  if found then
    return jsonb_build_object(
      'code', 'confirmed', 'confirmedSlot', v_answer.visible_slot,
      'duplicate', true, 'roomRevision', v_night.room_revision,
      'controlRevision', v_night.control_revision, 'playId', p_play_id
    );
  end if;

  select * into v_window
    from public.question_play_attempt_windows
   where play_id = p_play_id and player_id = v_player_id
   for update;
  if not found then
    insert into public.question_play_attempt_windows (
      play_id, player_id, window_started_at, attempt_count
    ) values (p_play_id, v_player_id, v_now, 1);
  elsif v_now >= v_window.window_started_at + interval '10 seconds' then
    update public.question_play_attempt_windows
       set window_started_at = v_now, attempt_count = 1
     where play_id = p_play_id and player_id = v_player_id;
  elsif v_window.attempt_count >= 10 then
    v_retry_ms := greatest(1, ceil(extract(epoch from (
      v_window.window_started_at + interval '10 seconds' - v_now
    )) * 1000)::integer);
    return jsonb_build_object('code', 'retry_later', 'retryAfterMs', v_retry_ms);
  else
    update public.question_play_attempt_windows
       set attempt_count = attempt_count + 1
     where play_id = p_play_id and player_id = v_player_id;
  end if;

  if v_play.status in ('resolved', 'undone') or v_now >= v_play.final_window_ends_at then
    return jsonb_build_object('code', 'deadline_passed');
  end if;

  v_scramble := public._live_scramble_for(v_play.question_id, v_player_id);
  v_canonical := v_scramble[p_visible_slot];
  insert into public.question_play_answers (
    play_id, player_id, submission_id, visible_slot, canonical_index,
    received_at, locked_at, ms_to_lock
  ) values (
    p_play_id, v_player_id, p_submission_id, p_visible_slot, v_canonical,
    v_now, v_now,
    greatest(0, floor(extract(epoch from (v_now - v_play.opened_at)) * 1000)::integer)
  );
  update public.question_plays
     set confirmed_count = confirmed_count + 1
   where id = p_play_id
   returning * into v_play;
  if v_play.status = 'accepting'
     and v_play.eligible_count > 0
     and v_play.confirmed_count = v_play.eligible_count
     and v_now < v_play.main_zero_at then
    update public.question_plays
       set status = 'all_in_hold',
           finalize_at = greatest(v_now + interval '1200 milliseconds', opened_at + interval '2 seconds')
     where id = p_play_id
     returning * into v_play;
  end if;
  update public.nights
     set room_revision = room_revision + 1
   where id = v_night.id
   returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night.id, p_run_id, p_play_id, v_play.game_id, v_play.question_id,
    v_night.room_revision, v_night.control_revision, 'answer_progress',
    jsonb_build_object(
      'status', v_play.status, 'eligibleCount', v_play.eligible_count,
      'confirmedCount', v_play.confirmed_count, 'finalizeAt', v_play.finalize_at
    )
  );
  return jsonb_build_object(
    'code', 'confirmed', 'confirmedSlot', p_visible_slot, 'duplicate', false,
    'playId', p_play_id, 'roomRevision', v_night.room_revision,
    'controlRevision', v_night.control_revision
  );
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
begin
  select g.night_id, n.current_run_id into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then return jsonb_build_object('code', 'not_found', 'applied', false); end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id,
    'begin_question_play_final_window', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then return v_claim; end if;

  select * into v_night from public.nights where id = v_night_id for update;
  if v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(v_night_id, p_command_id, 'stale');
  end if;
  select * into v_game from public.games where id = p_game_id and night_id = v_night_id for update;
  select * into v_play from public.question_plays
   where id = p_play_id and night_id = v_night_id and run_id = p_run_id and game_id = p_game_id
   for update;
  if not found then return public._live_reject_command(v_night_id, p_command_id, 'stale'); end if;
  update public.live_command_receipts
     set expected_play_id = p_play_id, expected_play_status = v_play.status
   where night_id = v_night_id and command_id = p_command_id;
  if v_play.status <> 'accepting' then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;

  update public.question_plays
     set status = 'final_window', final_window_starts_at = v_now,
         final_window_ends_at = v_now + interval '2 seconds',
         finalize_at = v_now + interval '2 seconds'
   where id = p_play_id
   returning * into v_play;
  update public.nights
     set room_revision = room_revision + 1, control_revision = control_revision + 1
   where id = v_night_id returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, p_play_id, p_game_id, v_play.question_id,
    v_night.room_revision, v_night.control_revision, 'final_window_started',
    jsonb_build_object('status', 'final_window', 'finalWindowEndsAt', v_play.final_window_ends_at)
  );
  v_result := jsonb_build_object(
    'code', 'applied', 'applied', true, 'runId', p_run_id, 'playId', p_play_id,
    'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts set status = 'applied', canonical_result = v_result,
    completed_at = clock_timestamp()
   where night_id = v_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

create or replace function public.finalize_current_play_if_due(
  p_room_code text,
  p_run_id uuid,
  p_play_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_night public.nights%rowtype;
  v_game public.games%rowtype;
  v_play public.question_plays%rowtype;
  v_question public.questions%rowtype;
  v_window public.play_finalize_attempt_windows%rowtype;
  v_retry_ms integer;
  v_reason text;
begin
  select * into v_night from public.nights
   where room_code = upper(replace(p_room_code, '·', '')) for update;
  if not found then return jsonb_build_object('code', 'not_found', 'applied', false); end if;
  if v_night.current_run_id is distinct from p_run_id then
    return jsonb_build_object('code', 'stale', 'applied', false);
  end if;
  select game_id into v_play.game_id from public.question_plays
   where id = p_play_id and night_id = v_night.id and run_id = p_run_id;
  if not found then return jsonb_build_object('code', 'stale', 'applied', false); end if;
  select * into v_game from public.games where id = v_play.game_id and night_id = v_night.id for update;
  select * into v_play from public.question_plays
   where id = p_play_id and night_id = v_night.id and run_id = p_run_id and game_id = v_game.id
   for update;

  select * into v_window from public.play_finalize_attempt_windows
   where play_id = p_play_id for update;
  if not found then
    insert into public.play_finalize_attempt_windows(play_id, window_started_at, attempt_count)
    values (p_play_id, v_now, 1);
  elsif v_now >= v_window.window_started_at + interval '10 seconds' then
    update public.play_finalize_attempt_windows
       set window_started_at = v_now, attempt_count = 1 where play_id = p_play_id;
  elsif v_window.attempt_count >= 120 then
    v_retry_ms := greatest(1, ceil(extract(epoch from (
      v_window.window_started_at + interval '10 seconds' - v_now
    )) * 1000)::integer);
    return jsonb_build_object('code', 'retry_later', 'retryAfterMs', v_retry_ms);
  else
    update public.play_finalize_attempt_windows
       set attempt_count = attempt_count + 1 where play_id = p_play_id;
  end if;

  if v_play.status = 'resolved' then
    return jsonb_build_object(
      'code', 'resolved', 'applied', false, 'runId', p_run_id, 'playId', p_play_id,
      'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
    );
  end if;
  if v_play.status = 'undone' then
    return jsonb_build_object('code', 'stale', 'applied', false);
  end if;

  if v_play.status = 'accepting' and v_now >= v_play.main_zero_at
     and v_now < v_play.final_window_ends_at then
    update public.question_plays
       set status = 'final_window', final_window_starts_at = v_play.main_zero_at,
           finalize_at = v_play.final_window_ends_at
     where id = p_play_id returning * into v_play;
    update public.nights
       set room_revision = room_revision + 1, control_revision = control_revision + 1
     where id = v_night.id returning * into v_night;
    insert into public.live_room_events (
      night_id, run_id, play_id, game_id, question_id, room_revision,
      control_revision, kind, payload
    ) values (
      v_night.id, p_run_id, p_play_id, v_game.id, v_play.question_id,
      v_night.room_revision, v_night.control_revision, 'final_window_started',
      jsonb_build_object('status', 'final_window', 'finalWindowEndsAt', v_play.final_window_ends_at)
    );
    return jsonb_build_object(
      'code', 'final_window', 'applied', true, 'runId', p_run_id, 'playId', p_play_id,
      'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
    );
  end if;

  if (v_play.status = 'accepting' and v_now < v_play.final_window_ends_at)
     or (v_play.status = 'all_in_hold' and v_now < v_play.finalize_at)
     or (v_play.status = 'final_window' and v_now < coalesce(v_play.finalize_at, v_play.final_window_ends_at)) then
    return jsonb_build_object(
      'code', 'not_due', 'applied', false, 'runId', p_run_id, 'playId', p_play_id,
      'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
    );
  end if;

  v_reason := case when v_play.status = 'all_in_hold' then 'all_in' else 'deadline' end;
  select * into v_question from public.questions where id = v_play.question_id for update;
  update public.question_play_answers
     set is_correct = (canonical_index = v_question.correct_index),
         awarded_points = case
           when canonical_index = v_question.correct_index and ms_to_lock < 5000
             then floor(coalesce(v_question.point_value, 0) * 1.1)::integer
           when canonical_index = v_question.correct_index
             then coalesce(v_question.point_value, 0)
           else 0
         end
   where play_id = p_play_id and is_correct is null;
  update public.questions set finished_at = v_now where id = v_play.question_id;
  update public.question_plays
     set status = 'resolved', resolved_at = v_now, resolution_reason = v_reason,
         finalize_at = coalesce(finalize_at, v_now)
   where id = p_play_id returning * into v_play;
  update public.nights
     set room_revision = room_revision + 1, control_revision = control_revision + 1
   where id = v_night.id returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night.id, p_run_id, p_play_id, v_game.id, v_play.question_id,
    v_night.room_revision, v_night.control_revision, 'play_resolved',
    jsonb_build_object(
      'status', 'resolved', 'eligibleCount', v_play.eligible_count,
      'confirmedCount', v_play.confirmed_count, 'reason', v_reason
    )
  );
  return jsonb_build_object(
    'code', 'resolved', 'applied', true, 'runId', p_run_id, 'playId', p_play_id,
    'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
  );
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
  select g.night_id, n.current_run_id into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then return jsonb_build_object('code', 'not_found', 'applied', false); end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id, 'undo_question_play', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then return v_claim; end if;

  select * into v_night from public.nights where id = v_night_id for update;
  if v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(v_night_id, p_command_id, 'stale');
  end if;
  select * into v_game from public.games where id = p_game_id and night_id = v_night_id for update;
  select * into v_play from public.question_plays
   where id = p_play_id and night_id = v_night_id and run_id = p_run_id and game_id = p_game_id
   for update;
  if not found then return public._live_reject_command(v_night_id, p_command_id, 'stale'); end if;
  update public.live_command_receipts
     set expected_play_id = p_play_id, expected_play_status = v_play.status
   where night_id = v_night_id and command_id = p_command_id;
  if v_play.status in ('resolved', 'undone')
     or v_now > v_play.opened_at + interval '2 seconds' then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;
  update public.question_plays
     set status = 'undone', finalize_at = null, final_window_starts_at = null,
         resolved_at = null, resolution_reason = null
   where id = p_play_id;
  update public.questions set played_at = null, finished_at = null where id = v_play.question_id;
  update public.nights
     set room_revision = room_revision + 1, control_revision = control_revision + 1
   where id = v_night_id returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, play_id, game_id, question_id, room_revision,
    control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, p_play_id, p_game_id, v_play.question_id,
    v_night.room_revision, v_night.control_revision, 'play_undone',
    jsonb_build_object('status', 'undone')
  );
  v_result := jsonb_build_object(
    'code', 'applied', 'applied', true, 'runId', p_run_id, 'playId', p_play_id,
    'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts set status = 'applied', canonical_result = v_result,
    completed_at = clock_timestamp()
   where night_id = v_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

create or replace function public.end_live_game(
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
  v_hash text := md5(concat_ws('|', 'end_live_game', p_game_id::text,
    p_run_id::text, p_expected_control_revision::text));
  v_claim jsonb;
  v_result jsonb;
begin
  select g.night_id, n.current_run_id into v_night_id, v_receipt_run_id
    from public.games g
    join public.nights n on n.id = g.night_id
   where g.id = p_game_id;
  if not found then return jsonb_build_object('code', 'not_found', 'applied', false); end if;
  v_claim := public._live_claim_command(
    v_night_id, p_command_id, v_receipt_run_id, 'end_live_game', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then return v_claim; end if;

  select * into v_night from public.nights where id = v_night_id for update;
  if v_night.current_run_id is distinct from p_run_id
     or v_night.control_revision <> p_expected_control_revision then
    return public._live_reject_command(v_night_id, p_command_id, 'stale');
  end if;
  select * into v_game from public.games where id = p_game_id and night_id = v_night_id for update;
  if v_game.state <> 'live' or exists (
    select 1 from public.question_plays qp
     where qp.game_id = p_game_id and qp.run_id = p_run_id
       and qp.status in ('accepting', 'all_in_hold', 'final_window')
  ) then
    return public._live_reject_command(v_night_id, p_command_id, 'invalid_state');
  end if;
  update public.games set state = 'done', ended_at = clock_timestamp() where id = p_game_id;
  update public.nights
     set room_revision = room_revision + 1, control_revision = control_revision + 1
   where id = v_night_id returning * into v_night;
  insert into public.live_room_events (
    night_id, run_id, game_id, room_revision, control_revision, kind, payload
  ) values (
    v_night_id, p_run_id, p_game_id, v_night.room_revision,
    v_night.control_revision, 'game_ended', jsonb_build_object('state', 'done')
  );
  v_result := jsonb_build_object(
    'code', 'applied', 'applied', true, 'runId', p_run_id, 'gameId', p_game_id,
    'roomRevision', v_night.room_revision, 'controlRevision', v_night.control_revision
  );
  update public.live_command_receipts set status = 'applied', canonical_result = v_result,
    completed_at = clock_timestamp()
   where night_id = v_night_id and command_id = p_command_id;
  return v_result;
end;
$$;

revoke all on function public._live_scramble_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public._live_existing_command_result(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._live_claim_command(uuid, uuid, uuid, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public._live_reject_command(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.open_night_run(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.start_live_game(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.open_question_play(uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.submit_question_play_answer(uuid, uuid, uuid, uuid, smallint) from public, anon, authenticated;
revoke all on function public.begin_question_play_final_window(uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.finalize_current_play_if_due(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.undo_question_play(uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.end_live_game(uuid, uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public._live_scramble_for(uuid, uuid) to service_role;
grant execute on function public._live_existing_command_result(uuid, uuid, text) to service_role;
grant execute on function public._live_claim_command(uuid, uuid, uuid, text, text, bigint, uuid) to service_role;
grant execute on function public._live_reject_command(uuid, uuid, text) to service_role;
grant execute on function public.open_night_run(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.start_live_game(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.open_question_play(uuid, uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.submit_question_play_answer(uuid, uuid, uuid, uuid, smallint) to service_role;
grant execute on function public.begin_question_play_final_window(uuid, uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.finalize_current_play_if_due(text, uuid, uuid) to service_role;
grant execute on function public.undo_question_play(uuid, uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.end_live_game(uuid, uuid, uuid, bigint) to service_role;

-- The resilient reveal RPC is privileged and receives a client-supplied
-- question id. Only a finalized board slot may cross that public boundary.
-- Private generation candidates and categories still under review must
-- remain invisible even if a stale or forged host request names them.

set search_path = public, extensions;

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
    v_night_id, p_command_id, v_receipt_run_id, 'open_question_play', v_hash,
    p_expected_control_revision, p_game_id
  );
  if not coalesce((v_claim->>'claimed')::boolean, false) then
    return public._live_mutation_envelope(false, v_claim);
  end if;

  select *
    into v_night
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

  select *
    into v_game
    from public.games
   where id = p_game_id
     and night_id = v_night_id
   for update;
  if v_game.state <> 'live' then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;
  select q.*
    into v_question
    from public.questions q
    join public.categories c on c.id = q.category_id
   where q.id = p_question_id
     and c.game_id = p_game_id
     and c.state = 'ready'
     and q.is_picked = true
     and q.point_value is not null
   for update of q;
  if not found or v_question.played_at is not null then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;
  v_category_id := v_question.category_id;
  if exists (
    select 1
      from public.question_plays qp
     where qp.run_id = p_run_id
       and qp.status in ('accepting', 'all_in_hold', 'final_window')
  ) then
    return public._live_mutation_envelope(
      false, public._live_reject_command(v_night_id, p_command_id, 'invalid_state')
    );
  end if;

  insert into public.question_plays (
    id, night_id, run_id, game_id, category_id, question_id, status,
    opened_at, main_zero_at, final_window_ends_at
  ) values (
    v_play_id, v_night_id, p_run_id, p_game_id, v_category_id, p_question_id,
    'accepting', v_now, v_now + interval '30 seconds', v_now + interval '32 seconds'
  );
  insert into public.question_play_eligibility (
    play_id, player_id, night_id, frozen_at
  )
  select v_play_id, p.id, v_night_id, v_now
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
   where gp.game_id = p_game_id
     and p.night_id = v_night_id
     and p.removed_at is null
     and p.can_answer = true;
  get diagnostics v_eligible = row_count;
  update public.question_plays
     set eligible_count = v_eligible
   where id = v_play_id;
  update public.questions
     set played_at = v_now
   where id = p_question_id;
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
    'code', 'applied', 'applied', true, 'eventKind', 'play_opened',
    'runId', p_run_id,
    'gameId', p_game_id, 'playId', v_play_id,
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

revoke all on function public.open_question_play(
  uuid, uuid, uuid, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.open_question_play(
  uuid, uuid, uuid, uuid, bigint
) to service_role;

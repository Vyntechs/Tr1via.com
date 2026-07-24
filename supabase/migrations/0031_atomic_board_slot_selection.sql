-- A board slot is both a point value and the exact selected question.
-- Keep those facts atomic so a host-edited candidate cannot appear placed in
-- setup while an older generated question remains the one played live.

set search_path = public, extensions;

create or replace function public.swap_point_value(
  p_question_id uuid,
  p_point_value integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_category_id uuid;
  v_locked_category_id uuid;
  v_game_state text;
  v_previous smallint;
  v_was_picked boolean;
  v_occupant_id uuid;
begin
  if p_point_value not in (100, 200, 300, 400, 500, 600, 700) then
    raise exception 'invalid board point value %', p_point_value;
  end if;

  select q.category_id
    into v_category_id
    from public.questions q
   where q.id = p_question_id;

  if v_category_id is null then
    raise exception 'question % not found', p_question_id;
  end if;

  -- One host surface at a time may mutate a category board. Taking this
  -- lock before either question row prevents opposite swaps from locking
  -- the same pair in reverse order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_category_id::text, 0)
  );

  -- Starting a game and changing its board must serialize on the canonical
  -- game row. Re-read the state only after the category lock so a swap that
  -- waited behind a start cannot continue with its earlier draft snapshot.
  select q.category_id, g.state
    into v_locked_category_id, v_game_state
    from public.questions q
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
   where q.id = p_question_id
   for update of g;

  if v_locked_category_id is null then
    raise exception 'question % not found', p_question_id;
  end if;
  if v_locked_category_id is distinct from v_category_id then
    raise exception 'question % changed categories; retry the board change', p_question_id;
  end if;
  if v_game_state in ('live', 'done') then
    raise exception 'the board cannot change after its game starts';
  end if;

  select q.point_value, q.is_picked
    into v_previous, v_was_picked
    from public.questions q
   where q.id = p_question_id
     and q.category_id = v_category_id
   for update;

  if not found then
    raise exception 'question % changed categories; retry the board change', p_question_id;
  end if;

  select id
    into v_occupant_id
    from public.questions
   where category_id = v_category_id
     and point_value = p_point_value::smallint
     and id <> p_question_id
   for update;

  if v_occupant_id is not null then
    if v_was_picked and v_previous is not null then
      update public.questions
         set point_value = v_previous,
             is_picked = true
       where id = v_occupant_id;
    else
      update public.questions
         set point_value = null,
             is_picked = false
       where id = v_occupant_id;
    end if;
  end if;

  update public.questions
     set point_value = p_point_value::smallint,
         is_picked = true
   where id = p_question_id;
end;
$$;

revoke all on function public.swap_point_value(uuid, integer) from public;
revoke all on function public.swap_point_value(uuid, integer) from authenticated, anon;
grant execute on function public.swap_point_value(uuid, integer) to service_role;

-- Every board-authoring statement takes the same canonical game-row lock as
-- Start. If Start wins, the authoring statement fails before changing
-- anything. If authoring wins, Start waits until the complete transaction
-- commits. This is the database invariant; route state snapshots are only UX
-- and are never the safety boundary.
create or replace function public._lock_board_authoring_game(
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state text;
begin
  select g.state
    into v_state
    from public.games g
   where g.id = p_game_id
   for update;

  -- A missing parent can occur only while its own cascading delete is
  -- already in progress. Foreign keys reject every ordinary orphan write.
  if not found then
    return;
  end if;
  if v_state in ('live', 'done') then
    raise exception using
      errcode = '55000',
      message = 'the board cannot change after its game starts';
  end if;
end;
$$;

revoke all on function public._lock_board_authoring_game(uuid)
  from public, authenticated, anon;
grant execute on function public._lock_board_authoring_game(uuid)
  to service_role;

-- A direct DML statement reaches its row trigger after locking the
-- question/category row. It must not wait behind Start's game-row lock,
-- because Start may already be waiting for that same child row. RPCs call
-- the blocking helper before touching child rows; triggers use this prompt
-- variant to break the inverse lock order safely.
create or replace function public._try_lock_board_authoring_game(
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state text;
begin
  select g.state
    into v_state
    from public.games g
   where g.id = p_game_id
   for update nowait;

  if not found then
    return;
  end if;
  if v_state in ('live', 'done') then
    raise exception using
      errcode = '55000',
      message = 'the board cannot change after its game starts';
  end if;
end;
$$;

revoke all on function public._try_lock_board_authoring_game(uuid)
  from public, authenticated, anon;
grant execute on function public._try_lock_board_authoring_game(uuid)
  to service_role;

-- Generation workers prepare unpicked candidates independently, but the
-- final seven-slot selection changes the public board. Serialize that final
-- step on the game before touching any selected question row. This keeps
-- parallel category completions from false-failing on the trigger's NOWAIT
-- deadlock guard while preserving stale-attempt fencing on the worker job.
create or replace function public.complete_question_generation(
  p_category_id uuid,
  p_attempt smallint,
  p_report jsonb,
  p_assignments jsonb,
  p_category_state text,
  p_written_count smallint,
  p_certified_count smallint,
  p_image_count smallint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.question_generation_jobs%rowtype;
  v_category public.categories%rowtype;
  v_count integer;
  v_distinct_ids integer;
  v_distinct_points integer;
  v_row record;
begin
  if p_category_state not in ('review', 'ready') then
    raise exception 'invalid completed category state';
  end if;
  if not public._lock_current_generation_attempt(p_category_id, p_attempt) then
    return jsonb_build_object('applied', false, 'code', 'stale');
  end if;

  select * into strict v_job
    from public.question_generation_jobs
   where category_id = p_category_id;

  -- The attempt row is already fenced above. Take the canonical game lock
  -- next, before category/question rows, matching Start and every explicit
  -- board-authoring RPC.
  perform public._lock_board_authoring_game(v_job.game_id);

  select * into strict v_category
    from public.categories
   where id = p_category_id;

  if p_assignments is not null then
    if p_category_state <> 'ready' or jsonb_typeof(p_assignments) <> 'array' then
      raise exception 'invalid generation auto-pick payload';
    end if;
    select count(*),
           count(distinct (item->>'id')::uuid),
           count(distinct (item->>'pointValue')::smallint)
      into v_count, v_distinct_ids, v_distinct_points
      from jsonb_array_elements(p_assignments) as item;
    if v_count <> 7 or v_distinct_ids <> 7 or v_distinct_points <> 7 then
      raise exception 'generation auto-pick requires seven distinct assignments';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_assignments) as item
       where (item->>'pointValue')::smallint
         not in (100, 200, 300, 400, 500, 600, 700)
    ) then
      raise exception 'generation auto-pick contains an invalid point value';
    end if;
    if (
      select count(*)
        from public.questions
       where category_id = p_category_id
         and id = any(array(
           select (item->>'id')::uuid
             from jsonb_array_elements(p_assignments) as item
         ))
    ) <> 7 then
      raise exception 'generation auto-pick question does not belong to category';
    end if;

    update public.questions
       set is_picked = false,
           point_value = null
     where category_id = p_category_id;
    for v_row in
      select (item->>'id')::uuid as id,
             (item->>'pointValue')::smallint as point_value
        from jsonb_array_elements(p_assignments) as item
    loop
      update public.questions
         set is_picked = true,
             point_value = v_row.point_value
       where id = v_row.id
         and category_id = p_category_id;
    end loop;
  elsif p_category_state = 'ready' then
    raise exception 'ready generation requires auto-pick assignments';
  end if;

  insert into public.question_generation_reports (
    category_id, game_id, night_id, host_id, category_name, topic, mode,
    status, requested_count, accepted_count, generated_count, rejected_count,
    rounds, verify_passes, llm_calls, tokens_in, tokens_out,
    estimated_cost_usd, image_target_count, image_attached_count,
    image_skipped_count, risk_flag_count, report
  ) values (
    p_category_id, v_job.game_id, v_job.night_id, v_job.host_id,
    v_category.name, v_category.topic, coalesce(p_report->>'mode', 'unknown'),
    coalesce(p_report->>'status', 'completed'),
    coalesce((p_report->>'requested_count')::smallint, 0),
    coalesce((p_report->>'accepted_count')::smallint, 0),
    coalesce((p_report->>'generated_count')::smallint, 0),
    coalesce((p_report->>'rejected_count')::smallint, 0),
    coalesce((p_report->>'rounds')::smallint, 0),
    coalesce((p_report->>'verify_passes')::smallint, 0),
    coalesce((p_report->>'llm_calls')::integer, 0),
    coalesce((p_report->>'tokens_in')::integer, 0),
    coalesce((p_report->>'tokens_out')::integer, 0),
    coalesce((p_report->>'estimated_cost_usd')::numeric, 0),
    coalesce((p_report->>'image_target_count')::smallint, 0),
    coalesce((p_report->>'image_attached_count')::smallint, 0),
    coalesce((p_report->>'image_skipped_count')::smallint, 0),
    coalesce((p_report->>'risk_flag_count')::integer, 0),
    coalesce(p_report->'report', '{}'::jsonb)
  );

  update public.categories
     set state = p_category_state
   where id = p_category_id;
  update public.question_generation_jobs
     set phase = 'ready',
         written_count = p_written_count,
         certified_count = p_certified_count,
         image_count = p_image_count,
         last_error = null,
         heartbeat_at = now(),
         updated_at = now()
   where category_id = p_category_id;

  return jsonb_build_object('applied', true, 'code', 'applied');
end;
$$;

revoke all on function public.complete_question_generation(
  uuid, smallint, jsonb, jsonb, text, smallint, smallint, smallint
) from public, authenticated, anon;
grant execute on function public.complete_question_generation(
  uuid, smallint, jsonb, jsonb, text, smallint, smallint, smallint
) to service_role;

create or replace function public._fence_question_authoring()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_category_id uuid;
  v_game_id uuid;
begin
  -- Live play owns only these two question fields. Every existing and future
  -- question field is authoring data unless it is explicitly allowlisted
  -- here, so new content columns cannot silently bypass the fence.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['played_at', 'finished_at'])
       is not distinct from
         (to_jsonb(old) - array['played_at', 'finished_at']) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    raise exception using
      errcode = '55000',
      message = 'a question cannot move to another category';
  end if;

  -- Generation creates, certifies, photographs, and occasionally discards
  -- unpicked candidates in parallel across all twelve categories. Those rows
  -- cannot appear in a live game, so they neither need nor should contend on
  -- the shared game lock. The instant a write selects or slots a question,
  -- it falls through to the fence below.
  if tg_op = 'INSERT'
     and not new.is_picked
     and new.point_value is null then
    return new;
  end if;
  if tg_op = 'DELETE'
     and not old.is_picked
     and old.point_value is null then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and not old.is_picked
     and old.point_value is null
     and not new.is_picked
     and new.point_value is null then
    return new;
  end if;

  v_category_id := case when tg_op = 'DELETE'
    then old.category_id else new.category_id end;
  select c.game_id
    into v_game_id
    from public.categories c
   where c.id = v_category_id;
  if not found then
    -- Preserve parent-table cascading deletes. An ordinary write cannot reach
    -- this branch because the category foreign key is authoritative.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform public._try_lock_board_authoring_game(v_game_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public._fence_category_authoring()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_game_id uuid;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.game_id is distinct from old.game_id then
    raise exception using
      errcode = '55000',
      message = 'a category cannot move to another game';
  end if;

  -- Draft-generation lifecycle transitions are internal preparation work and
  -- intentionally run in parallel. A category that is or was ready is the
  -- public board and still falls through to the game fence.
  if tg_op = 'UPDATE'
     and old.state in ('draft', 'generating', 'review')
     and new.state in ('draft', 'generating', 'review')
     and (to_jsonb(new) - array['state', 'flavor'])
       is not distinct from
         (to_jsonb(old) - array['state', 'flavor']) then
    return new;
  end if;

  v_game_id := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  perform public._try_lock_board_authoring_game(v_game_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public._fence_question_authoring()
  from public, authenticated, anon;
revoke all on function public._fence_category_authoring()
  from public, authenticated, anon;

drop trigger if exists fence_question_authoring on public.questions;
create trigger fence_question_authoring
before insert or update or delete on public.questions
for each row execute function public._fence_question_authoring();

drop trigger if exists fence_category_authoring on public.categories;
create trigger fence_category_authoring
before insert or update or delete on public.categories
for each row execute function public._fence_category_authoring();

-- PATCH /api/questions/:id enters once and returns once. Content, pick state,
-- and slot placement therefore cannot straddle Start in separate commits.
create or replace function public.apply_question_authoring_patch(
  p_question_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_patch jsonb := p_patch;
  v_point_value integer;
  v_game_id uuid;
  v_question public.questions%rowtype;
begin
  if jsonb_typeof(v_patch) <> 'object' or v_patch = '{}'::jsonb then
    raise exception 'question patch must be a non-empty object';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(v_patch) as key
     where key not in (
       'prompt', 'options', 'correct_index', 'difficulty', 'fact_blurb',
       'source', 'is_picked', 'point_value'
     )
  ) then
    raise exception 'question patch contains an unsupported field';
  end if;

  select c.game_id
    into v_game_id
    from public.questions q
    join public.categories c on c.id = q.category_id
   where q.id = p_question_id;
  if not found then
    raise exception 'question % not found', p_question_id;
  end if;
  perform public._lock_board_authoring_game(v_game_id);

  -- Unpick always frees the slot, even if a stale client also supplied a
  -- non-null point value.
  if v_patch ? 'is_picked'
     and not coalesce((v_patch->>'is_picked')::boolean, false) then
    v_patch := v_patch || '{"point_value": null}'::jsonb;
  end if;

  if v_patch ? 'point_value'
     and jsonb_typeof(v_patch->'point_value') <> 'null' then
    v_point_value := (v_patch->>'point_value')::integer;
    perform public.swap_point_value(p_question_id, v_point_value);
    v_patch := v_patch - 'point_value';
  end if;

  if v_patch <> '{}'::jsonb then
    update public.questions q
       set prompt = case when v_patch ? 'prompt'
             then v_patch->>'prompt' else q.prompt end,
           options = case when v_patch ? 'options'
             then v_patch->'options' else q.options end,
           correct_index = case when v_patch ? 'correct_index'
             then (v_patch->>'correct_index')::smallint else q.correct_index end,
           difficulty = case when v_patch ? 'difficulty'
             then (v_patch->>'difficulty')::smallint else q.difficulty end,
           fact_blurb = case when v_patch ? 'fact_blurb'
             then v_patch->>'fact_blurb' else q.fact_blurb end,
           source = case when v_patch ? 'source'
             then v_patch->>'source' else q.source end,
           is_picked = case when v_patch ? 'is_picked'
             then (v_patch->>'is_picked')::boolean else q.is_picked end,
           point_value = case when v_patch ? 'point_value'
             then null else q.point_value end
     where q.id = p_question_id
     returning q.* into v_question;
  else
    select q.*
      into v_question
      from public.questions q
     where q.id = p_question_id;
  end if;

  if not found then
    raise exception 'question % not found', p_question_id;
  end if;
  return to_jsonb(v_question);
end;
$$;

revoke all on function public.apply_question_authoring_patch(uuid, jsonb)
  from public, authenticated, anon;
grant execute on function public.apply_question_authoring_patch(uuid, jsonb)
  to service_role;

-- A reorder is one transaction, not a clear request followed by N set
-- requests. The deferrable category/point constraint validates the final
-- permutation at transaction end.
create or replace function public.reorder_category_board(
  p_category_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_game_id uuid;
  v_ids uuid[];
  v_points integer[];
  v_assignment_count integer;
  v_picked_count integer;
begin
  select c.game_id into v_game_id
    from public.categories c
   where c.id = p_category_id;
  if not found then
    raise exception 'category % not found', p_category_id;
  end if;
  perform public._lock_board_authoring_game(v_game_id);

  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'assignments must be an array';
  end if;
  select
      array_agg((item->>'id')::uuid order by ordinal),
      array_agg((item->>'pointValue')::integer order by ordinal),
      count(*)::integer
    into v_ids, v_points, v_assignment_count
    from jsonb_array_elements(p_assignments) with ordinality as value(item, ordinal);
  if v_assignment_count < 2 or v_assignment_count > 7
     or exists (
       select 1 from unnest(v_points) as point
        where point not in (100, 200, 300, 400, 500, 600, 700)
     )
     or (select count(distinct id) from unnest(v_ids) as id) <> v_assignment_count
     or (select count(distinct point) from unnest(v_points) as point) <> v_assignment_count then
    raise exception 'invalid board reorder assignments';
  end if;

  select count(*)::integer into v_picked_count
    from public.questions q
   where q.category_id = p_category_id
     and q.is_picked;
  if v_picked_count <> v_assignment_count
     or exists (
       select 1
         from unnest(v_ids) as requested_id
        where not exists (
          select 1 from public.questions q
           where q.id = requested_id
             and q.category_id = p_category_id
             and q.is_picked
        )
     ) then
    raise exception 'reorder must cover every picked question in this category';
  end if;

  update public.questions q
     set point_value = v_points[array_position(v_ids, q.id)]::smallint
   where q.category_id = p_category_id
     and q.id = any(v_ids);

  return jsonb_build_object('picked', p_assignments);
end;
$$;

revoke all on function public.reorder_category_board(uuid, jsonb)
  from public, authenticated, anon;
grant execute on function public.reorder_category_board(uuid, jsonb)
  to service_role;

-- Clear, assign, and mark-ready are one transaction. Start either sees the
-- complete board or waits; it can never observe the old multi-request middle.
create or replace function public.apply_category_picks(
  p_category_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_game_id uuid;
  v_ids uuid[];
  v_points integer[];
  v_assignment_count integer;
  v_found_count integer;
begin
  select c.game_id into v_game_id
    from public.categories c
   where c.id = p_category_id;
  if not found then
    raise exception 'category % not found', p_category_id;
  end if;
  perform public._lock_board_authoring_game(v_game_id);

  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'assignments must be an array';
  end if;
  select
      array_agg((item->>'id')::uuid order by ordinal),
      array_agg((item->>'pointValue')::integer order by ordinal),
      count(*)::integer
    into v_ids, v_points, v_assignment_count
    from jsonb_array_elements(p_assignments) with ordinality as value(item, ordinal);
  if v_assignment_count <> 7
     or exists (
       select 1 from unnest(v_points) as point
        where point not in (100, 200, 300, 400, 500, 600, 700)
     )
     or (select count(distinct id) from unnest(v_ids) as id) <> 7
     or (select count(distinct point) from unnest(v_points) as point) <> 7 then
    raise exception 'exactly seven distinct board assignments are required';
  end if;

  select count(*)::integer into v_found_count
    from public.questions q
   where q.category_id = p_category_id
     and q.id = any(v_ids);
  if v_found_count <> 7 then
    raise exception 'every picked question must belong to this category';
  end if;

  update public.questions q
     set is_picked = false,
         point_value = null
   where q.category_id = p_category_id;
  update public.questions q
     set is_picked = true,
         point_value = v_points[array_position(v_ids, q.id)]::smallint
   where q.category_id = p_category_id
     and q.id = any(v_ids);
  update public.categories c
     set state = 'ready'
   where c.id = p_category_id;

  return jsonb_build_object('picked', p_assignments);
end;
$$;

revoke all on function public.apply_category_picks(uuid, jsonb)
  from public, authenticated, anon;
grant execute on function public.apply_category_picks(uuid, jsonb)
  to service_role;

-- Manual entry is a replacement, not three independent HTTP writes. Lock
-- Start first, then replace the seven rows and mark the category ready in one
-- transaction so a live game can never inherit a cleared or half-written
-- manual board.
create or replace function public.replace_category_with_manual_questions(
  p_category_id uuid,
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_game_id uuid;
  v_state text;
  v_questions jsonb;
begin
  select c.game_id
    into v_game_id
    from public.categories c
   where c.id = p_category_id;
  if not found then
    raise exception 'category % not found', p_category_id;
  end if;

  perform public._lock_board_authoring_game(v_game_id);

  select c.state
    into v_state
    from public.categories c
   where c.id = p_category_id
     and c.game_id = v_game_id
   for update;
  if not found then
    raise exception 'category % changed games; retry manual entry', p_category_id;
  end if;
  if v_state not in ('draft', 'review') then
    raise exception using
      errcode = '55000',
      message = 'category is not editable for manual entry';
  end if;

  if jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) <> 7
     or exists (
       select 1
         from jsonb_array_elements(p_questions) as value(item)
        where nullif(btrim(item->>'prompt'), '') is null
           or jsonb_typeof(item->'options') <> 'array'
           or jsonb_array_length(item->'options') <> 4
           or (item->>'correct_index')::integer not between 0 and 3
     ) then
    raise exception 'exactly seven valid manual questions are required';
  end if;

  delete from public.questions q
   where q.category_id = p_category_id;

  with payload as (
    select item, ordinal
      from jsonb_array_elements(p_questions)
           with ordinality as value(item, ordinal)
  ),
  inserted as (
    insert into public.questions (
      category_id,
      point_value,
      prompt,
      options,
      correct_index,
      image_url,
      image_attribution,
      image_source,
      difficulty,
      source,
      is_picked,
      fact_blurb
    )
    select
      p_category_id,
      (ordinal * 100)::smallint,
      item->>'prompt',
      item->'options',
      (item->>'correct_index')::smallint,
      nullif(btrim(item->>'image_url'), ''),
      null,
      case when nullif(btrim(item->>'image_url'), '') is null
        then null else 'upload' end,
      ordinal::smallint,
      'host-edit',
      true,
      nullif(item->>'fact_blurb', '')
    from payload
    order by ordinal
    returning id, point_value, difficulty, prompt
  )
  select coalesce(
      jsonb_agg(to_jsonb(inserted) order by inserted.point_value),
      '[]'::jsonb
    )
    into v_questions
    from inserted;

  update public.categories c
     set state = 'ready'
   where c.id = p_category_id;

  return jsonb_build_object('questions', v_questions);
end;
$$;

revoke all on function public.replace_category_with_manual_questions(uuid, jsonb)
  from public, authenticated, anon;
grant execute on function public.replace_category_with_manual_questions(uuid, jsonb)
  to service_role;

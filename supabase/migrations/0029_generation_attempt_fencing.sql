-- 0029_generation_attempt_fencing.sql
--
-- Strict database fencing for resumable AI category generation.
--
-- Every worker-owned mutation locks the category's generation-job row and
-- validates the durable attempt in the SAME transaction as its side effect.
-- A replacement claim therefore either waits for the old mutation to commit,
-- or wins first and makes the old mutation a no-op. There is no check/write
-- timing window and no existing row is rewritten by this additive migration.

set search_path = pg_catalog, public;

create or replace function public._lock_current_generation_attempt(
  p_category_id uuid,
  p_attempt smallint
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt smallint;
  v_phase text;
begin
  select attempt, phase
    into v_attempt, v_phase
  from question_generation_jobs
  where category_id = p_category_id
  for update;

  return found
    and v_attempt = p_attempt
    and v_phase not in ('ready', 'needs_attention');
end;
$$;

create or replace function public.begin_question_generation(
  p_category_id uuid,
  p_target_count smallint,
  p_flavor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job question_generation_jobs%rowtype;
  v_state text;
  v_game_id uuid;
  v_night_id uuid;
  v_host_id uuid;
begin
  -- Existing jobs lock before the category, matching every effect's lock order.
  select * into v_job
  from question_generation_jobs
  where category_id = p_category_id
  for update;

  select c.state, c.game_id, g.night_id, n.host_id
    into v_state, v_game_id, v_night_id, v_host_id
  from categories c
  join games g on g.id = c.game_id
  join nights n on n.id = g.night_id
  where c.id = p_category_id
  for update of c;

  if not found or v_state not in ('draft', 'review') then
    return jsonb_build_object('applied', false, 'code', 'conflict');
  end if;

  if v_job.id is null then
    insert into question_generation_jobs (
      category_id, game_id, night_id, host_id, phase, target_count,
      written_count, certified_count, image_count, attempt, last_error,
      heartbeat_at, created_at, updated_at
    ) values (
      p_category_id, v_game_id, v_night_id, v_host_id, 'queued', p_target_count,
      0, 0, 0, 1, null, now(), now(), now()
    ) returning * into v_job;
  else
    update question_generation_jobs
    set phase = 'queued',
        target_count = p_target_count,
        written_count = 0,
        certified_count = 0,
        image_count = 0,
        attempt = attempt + 1,
        last_error = null,
        heartbeat_at = now(),
        updated_at = now()
    where category_id = p_category_id
    returning * into v_job;
  end if;

  update categories
  set state = 'generating', flavor = p_flavor
  where id = p_category_id;

  return jsonb_build_object(
    'applied', true,
    'code', 'applied',
    'job', to_jsonb(v_job)
  );
end;
$$;

create or replace function public.claim_question_generation_resume(
  p_category_id uuid,
  p_observed_attempt smallint,
  p_observed_phase text,
  p_observed_heartbeat_at timestamptz,
  p_flavor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job question_generation_jobs%rowtype;
begin
  select * into v_job
  from question_generation_jobs
  where category_id = p_category_id
  for update;

  if not found
    or v_job.attempt <> p_observed_attempt
    or v_job.phase <> p_observed_phase
    or v_job.heartbeat_at <> p_observed_heartbeat_at
    or not (
      v_job.phase = 'needs_attention'
      or v_job.heartbeat_at < now() - interval '90 seconds'
      or (v_job.phase = 'ready' and v_job.certified_count < v_job.target_count)
    )
  then
    return jsonb_build_object('applied', false, 'code', 'conflict');
  end if;

  update question_generation_jobs
  set phase = 'queued',
      attempt = attempt + 1,
      last_error = null,
      heartbeat_at = now(),
      updated_at = now()
  where category_id = p_category_id
  returning * into v_job;

  update categories
  set state = 'generating', flavor = p_flavor
  where id = p_category_id;

  return jsonb_build_object(
    'applied', true,
    'code', 'applied',
    'job', to_jsonb(v_job)
  );
end;
$$;

create or replace function public.commit_generation_questions(
  p_category_id uuid,
  p_attempt smallint,
  p_questions jsonb,
  p_delete_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer;
begin
  if not public._lock_current_generation_attempt(p_category_id, p_attempt) then
    return jsonb_build_object('applied', false, 'code', 'stale');
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'questions must be a JSON array';
  end if;

  insert into questions (
    id, category_id, prompt, options, correct_index, difficulty,
    fact_blurb, source, is_picked
  )
  select
    (item->>'id')::uuid,
    p_category_id,
    item->>'prompt',
    item->'options',
    (item->>'correctIndex')::smallint,
    (item->>'difficulty')::smallint,
    item->>'factBlurb',
    'ai',
    false
  from jsonb_array_elements(p_questions) as item;
  get diagnostics v_inserted = row_count;

  if coalesce(array_length(p_delete_ids, 1), 0) > 0 then
    delete from questions
    where category_id = p_category_id
      and id = any(p_delete_ids)
      and not is_picked;
  end if;

  return jsonb_build_object(
    'applied', true,
    'code', 'applied',
    'insertedCount', v_inserted
  );
end;
$$;

create or replace function public.commit_generation_photo(
  p_category_id uuid,
  p_attempt smallint,
  p_question_id uuid,
  p_image_url text,
  p_image_attribution text,
  p_image_source text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if not public._lock_current_generation_attempt(p_category_id, p_attempt) then
    return jsonb_build_object('applied', false, 'code', 'stale');
  end if;

  update questions
  set image_url = p_image_url,
      image_attribution = p_image_attribution,
      image_source = p_image_source
  where id = p_question_id
    and category_id = p_category_id;
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'generation question not found in category';
  end if;
  return jsonb_build_object('applied', true, 'code', 'applied');
end;
$$;

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
  v_job question_generation_jobs%rowtype;
  v_category categories%rowtype;
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
  from question_generation_jobs
  where category_id = p_category_id;
  select * into strict v_category
  from categories
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
      where (item->>'pointValue')::smallint not in (100,200,300,400,500,600,700)
    ) then
      raise exception 'generation auto-pick contains an invalid point value';
    end if;
    if (
      select count(*)
      from questions
      where category_id = p_category_id
        and id = any(array(
          select (item->>'id')::uuid
          from jsonb_array_elements(p_assignments) as item
        ))
    ) <> 7 then
      raise exception 'generation auto-pick question does not belong to category';
    end if;

    update questions
    set is_picked = false, point_value = null
    where category_id = p_category_id;
    for v_row in
      select (item->>'id')::uuid as id,
             (item->>'pointValue')::smallint as point_value
      from jsonb_array_elements(p_assignments) as item
    loop
      update questions
      set is_picked = true, point_value = v_row.point_value
      where id = v_row.id and category_id = p_category_id;
    end loop;
  elsif p_category_state = 'ready' then
    raise exception 'ready generation requires auto-pick assignments';
  end if;

  insert into question_generation_reports (
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

  update categories set state = p_category_state where id = p_category_id;
  update question_generation_jobs
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

create or replace function public.fail_question_generation(
  p_category_id uuid,
  p_attempt smallint,
  p_restore_state text,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_restore_state is not null and p_restore_state <> 'review' then
    raise exception 'invalid generation restore state';
  end if;
  if not public._lock_current_generation_attempt(p_category_id, p_attempt) then
    return jsonb_build_object('applied', false, 'code', 'stale');
  end if;

  if p_restore_state = 'review' then
    update categories set state = 'review' where id = p_category_id;
  end if;
  update question_generation_jobs
  set phase = 'needs_attention',
      last_error = p_error,
      heartbeat_at = now(),
      updated_at = now()
  where category_id = p_category_id;

  return jsonb_build_object('applied', true, 'code', 'applied');
end;
$$;

revoke all on function public._lock_current_generation_attempt(uuid, smallint) from public, anon, authenticated;
revoke all on function public.begin_question_generation(uuid, smallint, jsonb) from public, anon, authenticated;
revoke all on function public.claim_question_generation_resume(uuid, smallint, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.commit_generation_questions(uuid, smallint, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.commit_generation_photo(uuid, smallint, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_question_generation(uuid, smallint, jsonb, jsonb, text, smallint, smallint, smallint) from public, anon, authenticated;
revoke all on function public.fail_question_generation(uuid, smallint, text, text) from public, anon, authenticated;

grant execute on function public.begin_question_generation(uuid, smallint, jsonb) to service_role;
grant execute on function public.claim_question_generation_resume(uuid, smallint, text, timestamptz, jsonb) to service_role;
grant execute on function public.commit_generation_questions(uuid, smallint, jsonb, uuid[]) to service_role;
grant execute on function public.commit_generation_photo(uuid, smallint, uuid, text, text, text) to service_role;
grant execute on function public.complete_question_generation(uuid, smallint, jsonb, jsonb, text, smallint, smallint, smallint) to service_role;
grant execute on function public.fail_question_generation(uuid, smallint, text, text) to service_role;

comment on function public.commit_generation_questions(uuid, smallint, jsonb, uuid[]) is
  'Atomically persists a certified generation batch and optional reroll cleanup only for the current worker attempt.';

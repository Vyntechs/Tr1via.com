-- 0030_questions_photo_query.sql
--
-- Retain the per-question Pexels search phrase across resumable generation.
-- The existing fenced commit function is replaced with the same signature,
-- security mode, search path, privileges, and transactional behavior; only
-- the additive photo_query insert is new.

set search_path = pg_catalog, public;

alter table public.questions
  add column if not exists photo_query text;

comment on column public.questions.photo_query is
  'Per-question Pexels search phrase produced during generation and retained across resumable jobs.';

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
    fact_blurb, photo_query, source, is_picked
  )
  select
    (item->>'id')::uuid,
    p_category_id,
    item->>'prompt',
    item->'options',
    (item->>'correctIndex')::smallint,
    (item->>'difficulty')::smallint,
    item->>'factBlurb',
    nullif(btrim(item->>'photoQuery'), ''),
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

revoke all on function public.commit_generation_questions(uuid, smallint, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.commit_generation_questions(uuid, smallint, jsonb, uuid[])
  to service_role;

comment on function public.commit_generation_questions(uuid, smallint, jsonb, uuid[]) is
  'Atomically persists a certified generation batch and optional reroll cleanup only for the current worker attempt.';

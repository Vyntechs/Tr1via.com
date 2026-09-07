-- Serialize a legacy reset with timer, manual, and all-locked resolution.
-- Preserve the existing reset body, return shape, and service-role authority.
-- No scorer or resilient-engine behavior changes.

create or replace function public.reset_night_to_setup(p_night_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reveals_count int := 0;
  v_answers_count int := 0;
  v_finished_count int := 0;
  v_adjustments_count int := 0;
  v_categories_kept int := 0;
  v_picked_kept int := 0;
  v_players_kept int := 0;
begin
  -- Lock the same question rows as every legacy scorer, before any
  -- counts or deletes. If scoring wins, the subsequent statements see its
  -- committed resolve event; if reset wins, the scorer sees played_at = null
  -- after waiting and cannot resolve the retired question.
  -- Lock only questions (not their game/category parents), in a stable order
  -- for concurrent resets. A non-key-changing lock conflicts with scorers'
  -- FOR UPDATE locks without unnecessarily blocking foreign-key checks.
  perform q.id
    from public.questions q
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
   where g.night_id = p_night_id
     and g.state in ('live', 'done')
   order by q.id
   for no key update of q;

  select pg_catalog.count(*) into v_reveals_count
    from public.reveals r
    join public.games g on g.id = r.game_id
   where g.night_id = p_night_id
     and g.state in ('live', 'done');

  select pg_catalog.count(*) into v_answers_count
    from public.answers a
    join public.questions q on q.id = a.question_id
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
   where g.night_id = p_night_id
     and g.state in ('live', 'done');

  select pg_catalog.count(*) into v_finished_count
    from public.questions q
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
   where g.night_id = p_night_id
     and g.state in ('live', 'done')
     and q.finished_at is not null;

  select pg_catalog.count(*) into v_adjustments_count
    from public.adjustments adj
    join public.games g on g.id = adj.game_id
   where g.night_id = p_night_id
     and g.state in ('live', 'done');

  select pg_catalog.count(*) into v_categories_kept
    from public.categories c
    join public.games g on g.id = c.game_id
   where g.night_id = p_night_id;

  select pg_catalog.count(*) into v_picked_kept
    from public.questions q
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
   where g.night_id = p_night_id
     and q.is_picked = true;

  select pg_catalog.count(*) into v_players_kept
    from public.players p
   where p.night_id = p_night_id
     and p.removed_at is null;

  delete from public.reveals r
  using public.games g
   where r.game_id = g.id
     and g.night_id = p_night_id
     and g.state in ('live', 'done');

  delete from public.answers a
  using public.questions q, public.categories c, public.games g
   where a.question_id = q.id
     and q.category_id = c.id
     and c.game_id = g.id
     and g.night_id = p_night_id
     and g.state in ('live', 'done');

  delete from public.adjustments adj
  using public.games g
   where adj.game_id = g.id
     and g.night_id = p_night_id
     and g.state in ('live', 'done');

  update public.questions q
     set finished_at = null,
         played_at = null
    from public.categories c, public.games g
   where q.category_id = c.id
     and c.game_id = g.id
     and g.night_id = p_night_id
     and g.state in ('live', 'done');

  update public.games g
     set state = 'ready',
         started_at = null,
         ended_at = null
   where g.night_id = p_night_id
     and g.state in ('live', 'done');

  update public.nights n
     set opened_at = null
   where n.id = p_night_id;

  return pg_catalog.jsonb_build_object(
    'wiped', pg_catalog.jsonb_build_object(
      'reveals', v_reveals_count,
      'answers', v_answers_count,
      'finishedQuestions', v_finished_count,
      'adjustments', v_adjustments_count
    ),
    'kept', pg_catalog.jsonb_build_object(
      'categories', v_categories_kept,
      'pickedQuestions', v_picked_kept,
      'players', v_players_kept
    )
  );
end;
$$;

revoke all on function public.reset_night_to_setup(uuid) from public, anon, authenticated;
grant execute on function public.reset_night_to_setup(uuid) to service_role;

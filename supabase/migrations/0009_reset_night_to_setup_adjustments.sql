-- 0009_reset_night_to_setup_adjustments.sql
--
-- Adds adjustments wipe to reset_night_to_setup. The original 0008
-- function preserved adjustments rows (per-player point edits made via
-- AdjustPointsModal). Since the game_scores view sums answers.awarded_
-- points + adjustments.delta, surviving adjustments would corrupt the
-- leaderboard after a reset.
--
-- CREATE OR REPLACE on the existing function — same signature, same
-- grants, just additional behavior.

set search_path = public, extensions;

create or replace function public.reset_night_to_setup(p_night_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  -- Pre-count what's about to be wiped (live/done games only).
  select count(*) into v_reveals_count
  from reveals r
  join games g on g.id = r.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done');

  select count(*) into v_answers_count
  from answers a
  join questions q on q.id = a.question_id
  join categories c on c.id = q.category_id
  join games g on g.id = c.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done');

  select count(*) into v_finished_count
  from questions q
  join categories c on c.id = q.category_id
  join games g on g.id = c.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done')
    and q.finished_at is not null;

  select count(*) into v_adjustments_count
  from adjustments adj
  join games g on g.id = adj.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done');

  -- Count what's preserved (across all games regardless of state).
  select count(*) into v_categories_kept
  from categories c
  join games g on g.id = c.game_id
  where g.night_id = p_night_id;

  select count(*) into v_picked_kept
  from questions q
  join categories c on c.id = q.category_id
  join games g on g.id = c.game_id
  where g.night_id = p_night_id
    and q.is_picked = true;

  select count(*) into v_players_kept
  from players p
  where p.night_id = p_night_id
    and p.removed_at is null;

  -- The wipes — scoped to games in live/done. Draft/ready games untouched.
  delete from reveals r
  using games g
  where r.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  delete from answers a
  using questions q, categories c, games g
  where a.question_id = q.id
    and q.category_id = c.id
    and c.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  delete from adjustments adj
  using games g
  where adj.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  update questions q
  set finished_at = null, played_at = null
  from categories c, games g
  where q.category_id = c.id
    and c.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  update games
  set state = 'ready', started_at = null, ended_at = null
  where night_id = p_night_id
    and state in ('live', 'done');

  update nights
  set opened_at = null
  where id = p_night_id;

  return jsonb_build_object(
    'wiped', jsonb_build_object(
      'reveals', v_reveals_count,
      'answers', v_answers_count,
      'finishedQuestions', v_finished_count,
      'adjustments', v_adjustments_count
    ),
    'kept', jsonb_build_object(
      'categories', v_categories_kept,
      'pickedQuestions', v_picked_kept,
      'players', v_players_kept
    )
  );
end;
$$;

-- Restrict execution to the service role (admin client). The route
-- handler runs server-side as the service role; client-side calls would
-- fail this grant.
revoke all on function public.reset_night_to_setup(uuid) from public;
revoke all on function public.reset_night_to_setup(uuid) from authenticated, anon;
grant execute on function public.reset_night_to_setup(uuid) to service_role;

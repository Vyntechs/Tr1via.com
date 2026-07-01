-- Guarded all-locked auto-reveal.
--
-- The host route used to read eligibility in application code and then call
-- resolve_question(), which left a race window for participation/removal
-- changes. This function makes the eligibility decision and resolve happen in
-- one transaction while blocking concurrent writes to the rows that define
-- eligibility.

create or replace function public.resolve_question_if_all_locked(p_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  question_row record;
  eligible_count integer;
  locked_count integer;
begin
  select questions_row.id,
         questions_row.category_id,
         questions_row.played_at,
         questions_row.finished_at,
         c.game_id,
         g.night_id
    into question_row
    from public.questions questions_row
    join public.categories c on c.id = questions_row.category_id
    join public.games g on g.id = c.game_id
   where questions_row.id = p_question_id
   for update of questions_row;

  if question_row.id is null then
    raise exception 'question % not found', p_question_id;
  end if;

  if question_row.finished_at is not null then
    return true;
  end if;

  if question_row.played_at is null then
    raise exception 'question % was never revealed', p_question_id;
  end if;

  -- Prevent a game_participations insert/delete or players.removed_at update
  -- from changing the eligible set between the check and resolve_question().
  lock table public.game_participations in share row exclusive mode;
  lock table public.players in share row exclusive mode;

  perform 1
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
   where gp.game_id = question_row.game_id
     and p.night_id = question_row.night_id
     and p.removed_at is null
   for update of gp, p;

  select count(*)
    into eligible_count
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
   where gp.game_id = question_row.game_id
     and p.night_id = question_row.night_id
     and p.removed_at is null;

  if eligible_count = 0 then
    return false;
  end if;

  select count(distinct a.player_id)
    into locked_count
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
    join public.answers a
      on a.player_id = gp.player_id
     and a.question_id = question_row.id
   where gp.game_id = question_row.game_id
     and p.night_id = question_row.night_id
     and p.removed_at is null;

  if locked_count <> eligible_count then
    return false;
  end if;

  perform public.resolve_question(question_row.id);
  return true;
end;
$$;

revoke all on function public.resolve_question_if_all_locked(uuid) from public;
revoke all on function public.resolve_question_if_all_locked(uuid) from anon;
revoke all on function public.resolve_question_if_all_locked(uuid) from authenticated;
grant execute on function public.resolve_question_if_all_locked(uuid) to service_role;

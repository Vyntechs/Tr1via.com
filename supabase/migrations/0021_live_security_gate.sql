-- 0021_live_security_gate.sql
--
-- Player identity now lives only in the signed HTTP-only device cookie and
-- player writes flow through same-origin service-role routes. Remove the old
-- anonymous table authority that trusted a browser-supplied device header,
-- then pin every existing live SECURITY DEFINER function to trusted schemas.

set search_path = public, extensions;

-- The browser no longer reads or writes canonical answers directly.
revoke all on table public.answers from anon;
drop policy if exists answers_self_insert on public.answers;
drop policy if exists answers_self_select on public.answers;

-- Join, heartbeat, and participation mutations now use signed server routes.
revoke insert, update, delete on table public.players from anon;
revoke insert, update, delete on table public.game_participations from anon;

-- Returns the current player_id in a given night for the calling device.
-- This helper remains available to legacy read-only RLS policies, but its
-- elevated relation lookup can no longer be redirected through search_path.
create or replace function public.current_player_id(p_night_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.id
    from public.players p
   where p.night_id = p_night_id
     and p.device_id = public.current_device_id()
   limit 1;
$$;

-- Returns true if the current auth.uid() owns the host of this night.
create or replace function public.is_night_host(p_night_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.nights n
      join public.hosts h on h.id = n.host_id
     where n.id = p_night_id
       and h.user_id = auth.uid()
  );
$$;

-- Resolve a question (T+20 or host end-early). Behavior is unchanged from
-- 0001: score every answer, finish the question, and append a resolve reveal.
create or replace function public.resolve_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  q record;
begin
  select questions_row.id,
         questions_row.category_id,
         questions_row.correct_index,
         questions_row.point_value,
         questions_row.played_at,
         questions_row.finished_at
    into q
    from public.questions questions_row
   where questions_row.id = p_question_id
   for update;

  if q.id is null then
    raise exception 'question % not found', p_question_id;
  end if;
  if q.finished_at is not null then
    return;
  end if;
  if q.played_at is null then
    raise exception 'question % was never revealed', p_question_id;
  end if;

  update public.answers a
     set is_correct = (a.chosen_index = q.correct_index),
         awarded_points = case
           when a.chosen_index = q.correct_index and a.ms_to_lock < 5000
             then pg_catalog.floor(coalesce(q.point_value, 0) * 1.1)::int
           when a.chosen_index = q.correct_index
             then coalesce(q.point_value, 0)
           else 0
         end
   where a.question_id = q.id;

  update public.questions questions_row
     set finished_at = pg_catalog.now()
   where questions_row.id = q.id;

  insert into public.reveals (game_id, question_id, event, metadata)
  select c.game_id,
         q.id,
         'resolve',
         pg_catalog.jsonb_build_object(
           'correct_index', q.correct_index,
           'point_value', q.point_value
         )
    from public.categories c
   where c.id = q.category_id;
end;
$$;

-- Guarded all-locked auto-reveal. Locking and eligibility semantics are
-- unchanged from 0018; only name resolution and execute authority change.
create or replace function public.resolve_question_if_all_locked(p_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
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

  lock table public.game_participations in share row exclusive mode;
  lock table public.players in share row exclusive mode;

  perform 1
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
   where gp.game_id = question_row.game_id
     and p.night_id = question_row.night_id
     and p.removed_at is null
   for update of gp, p;

  select pg_catalog.count(*)
    into eligible_count
    from public.game_participations gp
    join public.players p on p.id = gp.player_id
   where gp.game_id = question_row.game_id
     and p.night_id = question_row.night_id
     and p.removed_at is null;

  if eligible_count = 0 then
    return false;
  end if;

  select pg_catalog.count(distinct a.player_id)
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

-- Reset live/done games while preserving the generated boards and players.
-- This is the latest 0009 body, including adjustment cleanup and counts.
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

-- Atomically exchange a board point-value slot. Behavior is unchanged from
-- 0012; every relation reference is now schema-qualified.
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
  v_previous smallint;
  v_occupant_id uuid;
begin
  select q.category_id, q.point_value
    into v_category_id, v_previous
    from public.questions q
   where q.id = p_question_id
   for update;

  if v_category_id is null then
    raise exception 'question % not found', p_question_id;
  end if;

  if v_previous is not distinct from p_point_value::smallint then
    return;
  end if;

  select q.id
    into v_occupant_id
    from public.questions q
   where q.category_id = v_category_id
     and q.point_value = p_point_value::smallint
     and q.id <> p_question_id
   for update;

  if v_occupant_id is not null then
    update public.questions q
       set point_value = v_previous
     where q.id = v_occupant_id;
  end if;

  update public.questions q
     set point_value = p_point_value::smallint
   where q.id = p_question_id;
end;
$$;

-- Live state mutations are server-only. Revoke PostgreSQL's default PUBLIC
-- execute grant as well as both browser-facing Supabase request roles.
revoke all on function public.resolve_question(uuid) from public, anon, authenticated;
grant execute on function public.resolve_question(uuid) to service_role;

revoke all on function public.resolve_question_if_all_locked(uuid) from public, anon, authenticated;
grant execute on function public.resolve_question_if_all_locked(uuid) to service_role;

revoke all on function public.reset_night_to_setup(uuid) from public, anon, authenticated;
grant execute on function public.reset_night_to_setup(uuid) to service_role;

revoke all on function public.swap_point_value(uuid, integer) from public, anon, authenticated;
grant execute on function public.swap_point_value(uuid, integer) to service_role;

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
  v_game_state text;
  v_previous smallint;
  v_was_picked boolean;
  v_occupant_id uuid;
begin
  if p_point_value not in (100, 200, 300, 400, 500, 600, 700) then
    raise exception 'invalid board point value %', p_point_value;
  end if;

  select q.category_id, q.point_value, q.is_picked, g.state
    into v_category_id, v_previous, v_was_picked, v_game_state
    from public.questions q
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
   where q.id = p_question_id
   ;

  if v_category_id is null then
    raise exception 'question % not found', p_question_id;
  end if;
  if v_game_state in ('live', 'done') then
    raise exception 'the board cannot change after its game starts';
  end if;

  -- One host surface at a time may mutate a category board. Taking this
  -- lock before either question row prevents opposite swaps from locking
  -- the same pair in reverse order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_category_id::text, 0)
  );

  select q.point_value, q.is_picked
    into v_previous, v_was_picked
    from public.questions q
   where q.id = p_question_id
   for update;

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

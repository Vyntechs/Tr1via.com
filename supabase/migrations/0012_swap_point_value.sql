-- 0012_swap_point_value.sql — atomic board-slot assignment for host edits.
--
-- The board's `unique (category_id, point_value) deferrable initially
-- deferred` (0001_init.sql) is only checked at transaction COMMIT. The PATCH
-- route used to "swap" a slot with three separate PostgREST updates — three
-- independent transactions — so the deferred constraint gave no protection
-- across them. Worse, it only looked for an occupant that was `is_picked`,
-- so a stale row sitting at the target slot (e.g. a question whose point
-- value was set but never picked, or one un-picked without clearing its
-- slot) was skipped and the save hit the unique index raw.
--
-- This function does the whole vacate-then-place in ONE transaction, finds
-- the occupant by (category_id, point_value) regardless of pick state, and
-- hands it the editing row's old slot (which may be null → it becomes
-- unplaced). The deferred constraint tolerates the transient overlap
-- because both writes commit together.

set search_path = public, extensions;

create or replace function swap_point_value(
  p_question_id uuid,
  p_point_value integer
)
returns void
language plpgsql
security definer
as $$
declare
  v_category_id uuid;
  v_previous smallint;
  v_occupant_id uuid;
begin
  -- Lock the editing row; read its category and current slot.
  select category_id, point_value
    into v_category_id, v_previous
    from questions
   where id = p_question_id
   for update;

  if v_category_id is null then
    raise exception 'question % not found', p_question_id;
  end if;

  -- Already in the target slot → nothing to do (and, by the unique index,
  -- no occupant can exist).
  if v_previous is not distinct from p_point_value::smallint then
    return;
  end if;

  -- Find ANY other row in this category holding the target slot — picked or
  -- not. A non-null point_value is the only thing the unique index sees.
  select id
    into v_occupant_id
    from questions
   where category_id = v_category_id
     and point_value = p_point_value::smallint
     and id <> p_question_id
   for update;

  -- Hand the displaced question the editing row's old slot (may be null).
  if v_occupant_id is not null then
    update questions set point_value = v_previous where id = v_occupant_id;
  end if;

  -- Land the editing row in the target slot.
  update questions set point_value = p_point_value::smallint where id = p_question_id;
end;
$$;

-- Restrict execution to the service role (admin client). The route handler
-- runs server-side as the service role; client-side anon/authenticated calls
-- would fail this grant, so a player can't rearrange a host's board.
revoke all on function public.swap_point_value(uuid, integer) from public;
revoke all on function public.swap_point_value(uuid, integer) from authenticated, anon;
grant execute on function public.swap_point_value(uuid, integer) to service_role;

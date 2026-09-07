-- Keep the legacy timer path redundant without letting every timer caller
-- publish the same room-wide transition. The wrapper owns the question row
-- lock before delegating to the existing idempotent scorer, so exactly one
-- concurrent caller receives true.
--
-- SECURITY INVOKER is intentional: this is called only by the server-side
-- service-role route, and it does not need privileges beyond its caller.
create or replace function public.resolve_question_once(p_question_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_finished_at timestamptz;
begin
  select q.finished_at
    into v_finished_at
    from public.questions q
   where q.id = p_question_id
   for update;

  if not found then
    raise exception 'question % not found', p_question_id;
  end if;

  if v_finished_at is not null then
    return false;
  end if;

  perform public.resolve_question(p_question_id);
  return true;
end;
$$;

revoke all on function public.resolve_question_once(uuid) from public;
revoke all on function public.resolve_question_once(uuid) from anon;
revoke all on function public.resolve_question_once(uuid) from authenticated;
grant execute on function public.resolve_question_once(uuid) to service_role;

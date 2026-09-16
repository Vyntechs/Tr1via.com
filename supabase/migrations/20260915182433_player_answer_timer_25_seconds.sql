-- 20260915182433_player_answer_timer_25_seconds.sql
--
-- Enforce the current legacy game's 25-second answer deadline at the final
-- database write. It does not alter any future answer system.
-- The application supplies a server-owned receipt timestamp; player clocks
-- are never trusted.

set search_path = public, extensions;

create or replace function public.enforce_legacy_answer_deadline()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question public.questions%rowtype;
begin
  select q.*
    into v_question
    from public.questions q
   where q.id = new.question_id
   for update;

  if not found or v_question.played_at is null then
    raise exception using
      errcode = 'TRNL0',
      message = 'legacy_answer_question_not_live';
  end if;

  -- The end is exclusive: 24.999 seconds is in; 25.000 seconds is out.
  if new.locked_at >= v_question.played_at + interval '25 seconds' then
    raise exception using
      errcode = 'TR025',
      message = 'legacy_answer_deadline_passed';
  end if;

  -- A host may end a question before the timer. A request received after
  -- that close is never admitted, even when 25 seconds have not elapsed.
  if v_question.finished_at is not null
     and new.locked_at >= v_question.finished_at then
    raise exception using
      errcode = 'TRCL0',
      message = 'legacy_answer_question_closed';
  end if;

  -- If a timely request and resolution cross inside the app, the stored
  -- receipt time decides. Preserve that answer and score it exactly as the
  -- normal resolver would, because the resolver may already have completed.
  if v_question.finished_at is not null then
    new.is_correct := new.chosen_index = v_question.correct_index;
    new.awarded_points := case
      when new.chosen_index = v_question.correct_index and new.ms_to_lock < 5000
        then pg_catalog.floor(coalesce(v_question.point_value, 0) * 1.1)::int
      when new.chosen_index = v_question.correct_index
        then coalesce(v_question.point_value, 0)
      else 0
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists answers_enforce_legacy_deadline on public.answers;
create trigger answers_enforce_legacy_deadline
before insert on public.answers
for each row execute function public.enforce_legacy_answer_deadline();

revoke all on function public.enforce_legacy_answer_deadline()
  from public, anon, authenticated;
grant execute on function public.enforce_legacy_answer_deadline()
  to service_role;

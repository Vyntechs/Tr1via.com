-- A host can drive the game from either the laptop or phone. Returning from
-- an answer reveal to the standings board must therefore be durable shared
-- game state, not component-local UI state.

alter table public.reveals
  drop constraint if exists reveals_event_check;

alter table public.reveals
  add constraint reveals_event_check
  check (event in ('reveal', 'undo', 'end-early', 'resolve', 'advance'));

-- Serialize the presentation transition per resolved question. A repeat tap
-- with the same finished_at timestamp is a no-op, while undo -> replay ->
-- resolve produces a new timestamp and may advance again.
create or replace function public.record_standings_advance(
  p_game_id uuid,
  p_question_id uuid,
  p_resolved_at timestamptz,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_finished_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text || ':' || p_question_id::text, 0)
  );

  select q.finished_at
    into v_finished_at
    from public.questions q
    join public.categories c on c.id = q.category_id
   where q.id = p_question_id
     and c.game_id = p_game_id
   for update of q;

  if not found then
    raise exception 'question % does not belong to game %', p_question_id, p_game_id;
  end if;

  if v_finished_at is null or v_finished_at is distinct from p_resolved_at then
    raise exception 'question resolution is stale';
  end if;

  if exists (
    select 1
      from public.reveals r
     where r.game_id = p_game_id
       and r.question_id = p_question_id
       and r.event = 'advance'
       and r.metadata->>'resolved_at' = v_finished_at::text
  ) then
    return false;
  end if;

  insert into public.reveals (game_id, question_id, event, occurred_at, metadata)
  values (
    p_game_id,
    p_question_id,
    'advance',
    p_occurred_at,
    pg_catalog.jsonb_build_object(
      'view', 'standings-board',
      'resolved_at', v_finished_at::text
    )
  );

  return true;
end;
$$;

revoke all on function public.record_standings_advance(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_standings_advance(uuid, uuid, timestamptz, timestamptz)
  to service_role;

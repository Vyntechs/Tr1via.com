-- Private, short-lived evidence for answering disputes and screen-delivery
-- investigations. This is not gameplay state and it is never published over
-- Realtime. Canonical accepted answers remain in answers/question_play_answers;
-- these rows cover only verified rejections and bounded presentation receipts.

set search_path = public, extensions;

create table public.answer_rejection_evidence (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.nights(id) on delete cascade,
  player_id uuid not null,
  answer_engine text not null
    check (answer_engine in ('legacy', 'resilient_v1')),
  game_id uuid not null,
  question_id uuid not null,
  run_id uuid,
  play_id uuid,
  question_opened_at timestamptz not null,
  client_action_id uuid,
  selected_index smallint not null check (selected_index between 0 and 3),
  reason text not null
    check (reason in (
      'deadline_passed',
      'question_closed',
      'late_retry_after_accept'
    )),
  deadline_at timestamptz not null,
  first_received_at timestamptz not null,
  last_received_at timestamptz not null,
  first_deadline_delta_ms integer not null,
  last_deadline_delta_ms integer not null,
  request_count integer not null default 1
    check (request_count between 1 and 1000),
  first_trace_id text check (
    first_trace_id is null or length(first_trace_id) between 1 and 128
  ),
  release_id text check (
    release_id is null or length(release_id) between 1 and 160
  ),
  expires_at timestamptz not null,
  constraint answer_rejection_evidence_player_night_fk
    foreign key (player_id, night_id)
    references public.players(id, night_id)
    on delete cascade,
  constraint answer_rejection_evidence_engine_shape check (
    (answer_engine = 'legacy' and run_id is null and play_id is null)
    or
    (answer_engine = 'resilient_v1' and run_id is not null and play_id is not null)
  ),
  constraint answer_rejection_evidence_chronology check (
    deadline_at > question_opened_at
    and last_received_at >= first_received_at
    and expires_at = first_received_at + interval '30 days'
  ),
  constraint answer_rejection_evidence_deadline_reason check (
    reason = 'question_closed' or first_deadline_delta_ms >= 0
  )
);

create unique index answer_rejection_evidence_legacy_identity_idx
  on public.answer_rejection_evidence (
    question_id, player_id, question_opened_at
  )
  where answer_engine = 'legacy';

create unique index answer_rejection_evidence_resilient_identity_idx
  on public.answer_rejection_evidence (play_id, player_id)
  where answer_engine = 'resilient_v1';

create index answer_rejection_evidence_night_time_idx
  on public.answer_rejection_evidence (night_id, first_received_at desc);

create index answer_rejection_evidence_question_player_idx
  on public.answer_rejection_evidence (
    question_id, player_id, first_received_at desc
  );

create index answer_rejection_evidence_player_idx
  on public.answer_rejection_evidence (player_id);

create index answer_rejection_evidence_expiry_idx
  on public.answer_rejection_evidence (expires_at);

create table public.incident_surface_events (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.nights(id) on delete cascade,
  player_id uuid,
  answer_engine text not null
    check (answer_engine in ('legacy', 'resilient_v1')),
  game_id uuid,
  question_id uuid,
  run_id uuid,
  play_id uuid,
  stage_key text not null check (length(stage_key) = 32),
  stage text not null
    check (stage in (
      'board',
      'question_open',
      'timer_zero',
      'answer_reveal',
      'scoreboard',
      'intermission',
      'finale'
    )),
  event_kind text not null
    check (event_kind in (
      'frame_committed',
      'recovery_started',
      'recovery_completed'
    )),
  surface_kind text not null
    check (surface_kind in (
      'host_laptop',
      'host_phone',
      'venue_tv',
      'player_phone'
    )),
  subject_key text not null check (length(subject_key) between 16 and 128),
  authoritative_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  current_when_received boolean not null,
  room_revision bigint check (room_revision is null or room_revision >= 0),
  control_revision bigint check (
    control_revision is null or control_revision >= 0
  ),
  server_room_revision_at_receipt bigint check (
    server_room_revision_at_receipt is null
    or server_room_revision_at_receipt >= 0
  ),
  server_control_revision_at_receipt bigint check (
    server_control_revision_at_receipt is null
    or server_control_revision_at_receipt >= 0
  ),
  delivery_path text not null
    check (delivery_path in (
      'initial_snapshot',
      'realtime_broadcast',
      'postgres_change',
      'route_poll',
      'manual_refresh',
      'unknown'
    )),
  surface_session_id uuid not null,
  client_event_id uuid not null,
  release_id text check (
    release_id is null or length(release_id) between 1 and 160
  ),
  trace_id text check (trace_id is null or length(trace_id) between 1 and 128),
  expires_at timestamptz not null,
  constraint incident_surface_events_player_night_fk
    foreign key (player_id, night_id)
    references public.players(id, night_id)
    on delete cascade,
  constraint incident_surface_events_surface_identity check (
    (surface_kind = 'player_phone' and player_id is not null)
    or
    (surface_kind <> 'player_phone' and player_id is null)
  ),
  constraint incident_surface_events_engine_shape check (
    (answer_engine = 'legacy'
      and run_id is null
      and play_id is null
      and room_revision is null
      and control_revision is null)
    or
    (answer_engine = 'resilient_v1'
      and run_id is not null
      and room_revision is not null
      and control_revision is not null)
  ),
  constraint incident_surface_events_question_stage_shape check (
    (stage in ('question_open', 'timer_zero', 'answer_reveal') and question_id is not null)
    or stage not in ('question_open', 'timer_zero', 'answer_reveal')
  ),
  constraint incident_surface_events_retention check (
    expires_at = received_at + interval '30 days'
  )
);

create unique index incident_surface_events_stage_receipt_idx
  on public.incident_surface_events (
    night_id, stage_key, surface_kind, subject_key, event_kind
  );

create unique index incident_surface_events_client_event_idx
  on public.incident_surface_events (night_id, client_event_id);

create index incident_surface_events_night_time_idx
  on public.incident_surface_events (night_id, received_at);

create index incident_surface_events_question_stage_idx
  on public.incident_surface_events (
    night_id, question_id, stage, received_at
  );

create index incident_surface_events_player_idx
  on public.incident_surface_events (player_id)
  where player_id is not null;

create index incident_surface_events_expiry_idx
  on public.incident_surface_events (expires_at);

alter table public.answer_rejection_evidence enable row level security;
alter table public.incident_surface_events enable row level security;

revoke all privileges on table
  public.answer_rejection_evidence,
  public.incident_surface_events
from public, anon, authenticated, service_role;

-- Only a trusted server route may record a verified legacy rejection. The
-- function derives ancestry and the 25-second deadline from canonical rows;
-- callers cannot attach evidence to a different night or invent a deadline.
create function public.record_legacy_answer_rejection(
  p_question_id uuid,
  p_player_id uuid,
  p_client_action_id uuid,
  p_selected_index smallint,
  p_received_at timestamptz,
  p_reason text,
  p_trace_id text default null,
  p_release_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_night_id uuid;
  v_game_id uuid;
  v_opened_at timestamptz;
  v_finished_at timestamptz;
  v_deadline_at timestamptz;
  v_delta_ms integer;
  v_existing_answer boolean;
  v_id uuid;
begin
  if p_selected_index not between 0 and 3
     or p_reason not in (
       'deadline_passed', 'question_closed', 'late_retry_after_accept'
     )
     or p_received_at is null
     or (p_trace_id is not null and length(p_trace_id) not between 1 and 128)
     or (p_release_id is not null and length(p_release_id) not between 1 and 160) then
    raise exception using errcode = '22023', message = 'invalid incident evidence';
  end if;

  select g.night_id, g.id, q.played_at, q.finished_at,
         exists (
           select 1
             from public.answers a
            where a.question_id = q.id
              and a.player_id = p_player_id
         )
    into v_night_id, v_game_id, v_opened_at, v_finished_at,
         v_existing_answer
    from public.questions q
    join public.categories c on c.id = q.category_id
    join public.games g on g.id = c.game_id
    join public.nights n on n.id = g.night_id
   where q.id = p_question_id
     and n.answer_engine = 'legacy';

  if not found or v_opened_at is null then
    raise exception using errcode = '22023', message = 'invalid legacy question';
  end if;
  if not exists (
    select 1 from public.players p
     where p.id = p_player_id
       and p.night_id = v_night_id
  ) then
    raise exception using errcode = '22023', message = 'invalid legacy player';
  end if;

  v_deadline_at := v_opened_at + interval '25 seconds';
  v_delta_ms := floor(
    extract(epoch from (p_received_at - v_deadline_at)) * 1000
  )::integer;

  if p_reason = 'deadline_passed'
     and (p_received_at < v_deadline_at or v_existing_answer) then
    raise exception using errcode = '22023', message = 'invalid deadline rejection';
  end if;
  if p_reason = 'late_retry_after_accept'
     and (p_received_at < v_deadline_at or not v_existing_answer) then
    raise exception using errcode = '22023', message = 'invalid late retry';
  end if;
  if p_reason = 'question_closed'
     and (v_finished_at is null or p_received_at < v_finished_at) then
    raise exception using errcode = '22023', message = 'invalid closed rejection';
  end if;

  insert into public.answer_rejection_evidence (
    night_id, player_id, answer_engine, game_id, question_id,
    question_opened_at, client_action_id, selected_index, reason,
    deadline_at, first_received_at, last_received_at,
    first_deadline_delta_ms, last_deadline_delta_ms,
    first_trace_id, release_id, expires_at
  ) values (
    v_night_id, p_player_id, 'legacy', v_game_id, p_question_id,
    v_opened_at, p_client_action_id, p_selected_index, p_reason,
    v_deadline_at, p_received_at, p_received_at,
    v_delta_ms, v_delta_ms,
    p_trace_id, p_release_id, p_received_at + interval '30 days'
  )
  on conflict (question_id, player_id, question_opened_at)
    where answer_engine = 'legacy'
  do update set
    first_received_at = least(
      public.answer_rejection_evidence.first_received_at,
      excluded.first_received_at
    ),
    client_action_id = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.client_action_id
      else public.answer_rejection_evidence.client_action_id
    end,
    selected_index = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.selected_index
      else public.answer_rejection_evidence.selected_index
    end,
    reason = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.reason
      else public.answer_rejection_evidence.reason
    end,
    first_deadline_delta_ms = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.first_deadline_delta_ms
      else public.answer_rejection_evidence.first_deadline_delta_ms
    end,
    first_trace_id = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.first_trace_id
      else public.answer_rejection_evidence.first_trace_id
    end,
    release_id = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.release_id
      else public.answer_rejection_evidence.release_id
    end,
    last_received_at = greatest(
      public.answer_rejection_evidence.last_received_at,
      excluded.last_received_at
    ),
    last_deadline_delta_ms = case
      when excluded.last_received_at
        > public.answer_rejection_evidence.last_received_at
      then excluded.last_deadline_delta_ms
      else public.answer_rejection_evidence.last_deadline_delta_ms
    end,
    request_count = least(
      1000,
      public.answer_rejection_evidence.request_count + 1
    ),
    expires_at = least(
      public.answer_rejection_evidence.first_received_at,
      excluded.first_received_at
    ) + interval '30 days'
  returning id into v_id;

  return v_id;
end;
$$;

-- Resilient-engine equivalent. The final deadline and canonical ancestry come
-- from the immutable play identity rather than the request body.
create function public.record_resilient_answer_rejection(
  p_play_id uuid,
  p_run_id uuid,
  p_player_id uuid,
  p_client_action_id uuid,
  p_selected_index smallint,
  p_received_at timestamptz,
  p_reason text,
  p_trace_id text default null,
  p_release_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_play public.question_plays%rowtype;
  v_delta_ms integer;
  v_existing_answer boolean;
  v_id uuid;
begin
  if p_selected_index not between 0 and 3
     or p_reason not in (
       'deadline_passed', 'question_closed', 'late_retry_after_accept'
     )
     or p_received_at is null
     or (p_trace_id is not null and length(p_trace_id) not between 1 and 128)
     or (p_release_id is not null and length(p_release_id) not between 1 and 160) then
    raise exception using errcode = '22023', message = 'invalid incident evidence';
  end if;

  select qp.* into v_play
    from public.question_plays qp
    join public.nights n on n.id = qp.night_id
   where qp.id = p_play_id
     and qp.run_id = p_run_id
     and n.answer_engine = 'resilient_v1';
  if not found then
    raise exception using errcode = '22023', message = 'invalid resilient play';
  end if;
  if not exists (
    select 1
      from public.question_play_eligibility e
     where e.play_id = p_play_id
       and e.player_id = p_player_id
  ) then
    raise exception using errcode = '22023', message = 'ineligible resilient player';
  end if;
  select exists (
    select 1
      from public.question_play_answers a
     where a.play_id = p_play_id
       and a.player_id = p_player_id
  ) into v_existing_answer;

  v_delta_ms := floor(
    extract(epoch from (p_received_at - v_play.final_window_ends_at)) * 1000
  )::integer;
  if p_reason = 'deadline_passed'
     and (p_received_at < v_play.final_window_ends_at or v_existing_answer) then
    raise exception using errcode = '22023', message = 'invalid deadline rejection';
  end if;
  if p_reason = 'late_retry_after_accept'
     and (p_received_at < v_play.final_window_ends_at or not v_existing_answer) then
    raise exception using errcode = '22023', message = 'invalid late retry';
  end if;
  if p_reason = 'question_closed'
     and (v_play.resolved_at is null or p_received_at < v_play.resolved_at) then
    raise exception using errcode = '22023', message = 'invalid closed rejection';
  end if;

  insert into public.answer_rejection_evidence (
    night_id, player_id, answer_engine, game_id, question_id,
    run_id, play_id, question_opened_at, client_action_id, selected_index,
    reason, deadline_at, first_received_at, last_received_at,
    first_deadline_delta_ms, last_deadline_delta_ms,
    first_trace_id, release_id, expires_at
  ) values (
    v_play.night_id, p_player_id, 'resilient_v1', v_play.game_id,
    v_play.question_id, v_play.run_id, v_play.id, v_play.opened_at,
    p_client_action_id, p_selected_index, p_reason,
    v_play.final_window_ends_at, p_received_at, p_received_at,
    v_delta_ms, v_delta_ms, p_trace_id, p_release_id,
    p_received_at + interval '30 days'
  )
  on conflict (play_id, player_id)
    where answer_engine = 'resilient_v1'
  do update set
    first_received_at = least(
      public.answer_rejection_evidence.first_received_at,
      excluded.first_received_at
    ),
    client_action_id = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.client_action_id
      else public.answer_rejection_evidence.client_action_id
    end,
    selected_index = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.selected_index
      else public.answer_rejection_evidence.selected_index
    end,
    reason = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.reason
      else public.answer_rejection_evidence.reason
    end,
    first_deadline_delta_ms = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.first_deadline_delta_ms
      else public.answer_rejection_evidence.first_deadline_delta_ms
    end,
    first_trace_id = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.first_trace_id
      else public.answer_rejection_evidence.first_trace_id
    end,
    release_id = case
      when excluded.first_received_at
        < public.answer_rejection_evidence.first_received_at
      then excluded.release_id
      else public.answer_rejection_evidence.release_id
    end,
    last_received_at = greatest(
      public.answer_rejection_evidence.last_received_at,
      excluded.last_received_at
    ),
    last_deadline_delta_ms = case
      when excluded.last_received_at
        > public.answer_rejection_evidence.last_received_at
      then excluded.last_deadline_delta_ms
      else public.answer_rejection_evidence.last_deadline_delta_ms
    end,
    request_count = least(
      1000,
      public.answer_rejection_evidence.request_count + 1
    ),
    expires_at = least(
      public.answer_rejection_evidence.first_received_at,
      excluded.first_received_at
    ) + interval '30 days'
  returning id into v_id;

  return v_id;
end;
$$;

-- Store one idempotent historical surface event. Unlike the five-minute
-- current-health cache, a valid older stage is retained and explicitly marked
-- non-current so a recovery delay can be reconstructed later.
create function public.record_incident_surface_event(
  p_night_id uuid,
  p_player_id uuid,
  p_answer_engine text,
  p_game_id uuid,
  p_question_id uuid,
  p_run_id uuid,
  p_play_id uuid,
  p_stage text,
  p_event_kind text,
  p_surface_kind text,
  p_subject_key text,
  p_authoritative_at timestamptz,
  p_current_when_received boolean,
  p_room_revision bigint,
  p_control_revision bigint,
  p_server_room_revision_at_receipt bigint,
  p_server_control_revision_at_receipt bigint,
  p_delivery_path text,
  p_surface_session_id uuid,
  p_client_event_id uuid,
  p_release_id text default null,
  p_trace_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_key text;
  v_received_at timestamptz := clock_timestamp();
  v_question_opened_at timestamptz;
  v_question_finished_at timestamptz;
  v_play_opened_at timestamptz;
  v_play_resolved_at timestamptz;
  v_id uuid;
begin
  if p_answer_engine not in ('legacy', 'resilient_v1')
     or p_stage not in (
       'board', 'question_open', 'timer_zero', 'answer_reveal', 'scoreboard',
       'intermission', 'finale'
     )
     or p_event_kind not in (
       'frame_committed', 'recovery_started', 'recovery_completed'
     )
     or p_surface_kind not in (
       'host_laptop', 'host_phone', 'venue_tv', 'player_phone'
     )
     or p_delivery_path not in (
       'initial_snapshot', 'realtime_broadcast', 'postgres_change',
       'route_poll', 'manual_refresh', 'unknown'
     )
     or p_subject_key is null
     or length(p_subject_key) not between 16 and 128
     or p_authoritative_at is null
     or p_surface_session_id is null
     or p_client_event_id is null
     or (p_release_id is not null and length(p_release_id) not between 1 and 160)
     or (p_trace_id is not null and length(p_trace_id) not between 1 and 128) then
    raise exception using errcode = '22023', message = 'invalid surface evidence';
  end if;
  if not exists (
    select 1 from public.nights n
     where n.id = p_night_id
       and n.answer_engine = p_answer_engine
  ) then
    raise exception using errcode = '22023', message = 'invalid surface night';
  end if;
  if (p_surface_kind = 'player_phone') <> (p_player_id is not null) then
    raise exception using errcode = '22023', message = 'invalid surface subject';
  end if;
  if p_player_id is not null and not exists (
    select 1 from public.players p
     where p.id = p_player_id
       and p.night_id = p_night_id
  ) then
    raise exception using errcode = '22023', message = 'invalid surface player';
  end if;
  if p_stage in ('question_open', 'timer_zero', 'answer_reveal')
     and p_question_id is null then
    raise exception using errcode = '22023', message = 'missing surface question';
  end if;
  if p_game_id is not null and not exists (
    select 1 from public.games g
     where g.id = p_game_id
       and g.night_id = p_night_id
  ) then
    raise exception using errcode = '22023', message = 'invalid surface game';
  end if;
  if p_question_id is not null and not exists (
    select 1
      from public.questions q
      join public.categories c on c.id = q.category_id
      join public.games g on g.id = c.game_id
     where q.id = p_question_id
       and g.id = p_game_id
       and g.night_id = p_night_id
  ) then
    raise exception using errcode = '22023', message = 'invalid surface question';
  end if;
  if p_answer_engine = 'legacy'
     and (p_run_id is not null or p_play_id is not null
       or p_room_revision is not null or p_control_revision is not null) then
    raise exception using errcode = '22023', message = 'invalid legacy surface';
  end if;
  if p_answer_engine = 'resilient_v1'
     and (p_run_id is null or p_room_revision is null
       or p_control_revision is null) then
    raise exception using errcode = '22023', message = 'invalid resilient surface';
  end if;
  if p_answer_engine = 'legacy'
     and p_stage in ('question_open', 'answer_reveal') then
    select q.played_at, q.finished_at
      into v_question_opened_at, v_question_finished_at
      from public.questions q
     where q.id = p_question_id;
    if (p_stage = 'question_open'
        and v_question_opened_at is distinct from p_authoritative_at)
       or (p_stage = 'answer_reveal'
        and v_question_finished_at is distinct from p_authoritative_at) then
      raise exception using errcode = '22023', message = 'invalid legacy stage';
    end if;
  end if;
  if p_answer_engine = 'resilient_v1'
     and p_stage in ('question_open', 'answer_reveal') then
    if p_play_id is null then
      raise exception using errcode = '22023', message = 'missing resilient play';
    end if;
    select qp.opened_at, qp.resolved_at
      into v_play_opened_at, v_play_resolved_at
      from public.question_plays qp
     where qp.id = p_play_id
       and qp.night_id = p_night_id
       and qp.run_id = p_run_id
       and qp.game_id = p_game_id
       and qp.question_id = p_question_id;
    if not found
       or (p_stage = 'question_open'
         and v_play_opened_at is distinct from p_authoritative_at)
       or (p_stage = 'answer_reveal'
         and v_play_resolved_at is distinct from p_authoritative_at) then
      raise exception using errcode = '22023', message = 'invalid resilient stage';
    end if;
  end if;

  v_stage_key := md5(concat_ws(
    '|', p_answer_engine, p_night_id::text,
    coalesce(p_run_id::text, ''), coalesce(p_play_id::text, ''),
    coalesce(p_game_id::text, ''), coalesce(p_question_id::text, ''),
    p_stage, p_authoritative_at::text
  ));

  insert into public.incident_surface_events (
    night_id, player_id, answer_engine, game_id, question_id, run_id,
    play_id, stage_key, stage, event_kind, surface_kind, subject_key,
    authoritative_at, received_at, current_when_received,
    room_revision, control_revision, server_room_revision_at_receipt,
    server_control_revision_at_receipt, delivery_path, surface_session_id,
    client_event_id, release_id, trace_id, expires_at
  ) values (
    p_night_id, p_player_id, p_answer_engine, p_game_id, p_question_id,
    p_run_id, p_play_id, v_stage_key, p_stage, p_event_kind,
    p_surface_kind, p_subject_key, p_authoritative_at, v_received_at,
    p_current_when_received, p_room_revision, p_control_revision,
    p_server_room_revision_at_receipt,
    p_server_control_revision_at_receipt, p_delivery_path,
    p_surface_session_id, p_client_event_id, p_release_id, p_trace_id,
    v_received_at + interval '30 days'
  )
  on conflict (night_id, stage_key, surface_kind, subject_key, event_kind)
  do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id
      from public.incident_surface_events e
     where e.night_id = p_night_id
       and e.stage_key = v_stage_key
       and e.surface_kind = p_surface_kind
       and e.subject_key = p_subject_key
       and e.event_kind = p_event_kind;
  end if;
  return v_id;
end;
$$;

-- Delete in small batches so retention cannot hold a long-running lock. A
-- scheduler may call this repeatedly later; this migration does not enable or
-- configure pg_cron.
create function public.cleanup_expired_incident_evidence(
  p_batch_size integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer_count integer := 0;
  v_surface_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_batch_size not between 1 and 50000 then
    raise exception using errcode = '22023', message = 'invalid cleanup batch size';
  end if;

  delete from public.answer_rejection_evidence e
   where e.id in (
     select expired.id
       from public.answer_rejection_evidence expired
      where expired.expires_at <= v_now
      order by expired.expires_at, expired.id
      limit p_batch_size
   );
  get diagnostics v_answer_count = row_count;

  delete from public.incident_surface_events e
   where e.id in (
     select expired.id
       from public.incident_surface_events expired
      where expired.expires_at <= v_now
      order by expired.expires_at, expired.id
      limit p_batch_size
   );
  get diagnostics v_surface_count = row_count;

  return jsonb_build_object(
    'answerRejections', v_answer_count,
    'surfaceEvents', v_surface_count
  );
end;
$$;

revoke all privileges on function public.record_legacy_answer_rejection(
  uuid, uuid, uuid, smallint, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all privileges on function public.record_resilient_answer_rejection(
  uuid, uuid, uuid, uuid, smallint, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all privileges on function public.record_incident_surface_event(
  uuid, uuid, text, uuid, uuid, uuid, uuid, text, text, text, text,
  timestamptz, boolean, bigint, bigint, bigint, bigint, text, uuid, uuid,
  text, text
) from public, anon, authenticated;
revoke all privileges on function public.cleanup_expired_incident_evidence(
  integer
) from public, anon, authenticated;

grant execute on function public.record_legacy_answer_rejection(
  uuid, uuid, uuid, smallint, timestamptz, text, text, text
) to service_role;
grant execute on function public.record_resilient_answer_rejection(
  uuid, uuid, uuid, uuid, smallint, timestamptz, text, text, text
) to service_role;
grant execute on function public.record_incident_surface_event(
  uuid, uuid, text, uuid, uuid, uuid, uuid, text, text, text, text,
  timestamptz, boolean, bigint, bigint, bigint, bigint, text, uuid, uuid,
  text, text
) to service_role;
grant execute on function public.cleanup_expired_incident_evidence(
  integer
) to service_role;

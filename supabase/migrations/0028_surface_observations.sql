-- 0028_surface_observations.sql
--
-- Private, non-authoritative delivery receipts. These rows may describe what
-- a surface last painted, but they cannot advance a game, resolve a question,
-- alter a score, or expose a player's answer. One upserted row per opaque
-- subject keeps the store bounded; observed_at supports short-lived cleanup.

set search_path = public, extensions;

create table public.surface_observations (
  night_id uuid not null references public.nights(id) on delete cascade,
  surface_kind text not null
    check (surface_kind in ('tv', 'player')),
  subject_key text not null,
  run_id uuid,
  room_revision bigint not null
    check (room_revision >= 0),
  control_revision bigint not null
    check (control_revision >= 0),
  play_id uuid,
  observed_at timestamptz not null default now(),
  primary key (night_id, surface_kind, subject_key)
);

create index surface_observations_expiry_idx
  on public.surface_observations (observed_at);

-- Defense in depth: browsers have no direct policy or table privilege.
-- Authenticated server routes validate identity and use service_role writes.
alter table public.surface_observations enable row level security;

revoke all privileges on table public.surface_observations
from public, anon, authenticated;

grant all privileges on table public.surface_observations
to service_role;

-- Observations are operational telemetry, not game history. Keep the cleanup
-- boundary fixed, narrow, and callable only by trusted server code.
create function public.cleanup_expired_surface_observations()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.surface_observations
   where observed_at < pg_catalog.now() - interval '5 minutes';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all privileges
on function public.cleanup_expired_surface_observations()
from public, anon, authenticated;

grant execute
on function public.cleanup_expired_surface_observations()
to service_role;

-- Canonical-check, monotonicity, retention, and rate limiting are one trusted
-- transaction. A route-level check is useful feedback, but it cannot close
-- the race where the host advances between that read and this write.
create function public.observe_surface_delivery(
  p_night_id uuid,
  p_surface_kind text,
  p_subject_key text,
  p_run_id uuid,
  p_room_revision bigint,
  p_control_revision bigint,
  p_play_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_room_revision bigint;
  v_control_revision bigint;
  v_play_id uuid;
  v_existing public.surface_observations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_surface_kind not in ('tv', 'player')
     or p_subject_key is null
     or pg_catalog.length(p_subject_key) < 16 then
    return 'invalid';
  end if;

  -- A row lock cannot serialize the first write because no row exists yet.
  -- Lock the opaque subject identity for this transaction before lookup so
  -- simultaneous first paints yield exactly one accepted receipt.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_night_id::text || ':' || p_surface_kind || ':' || p_subject_key,
      0
    )
  );

  select current_run_id, room_revision, control_revision
    into v_run_id, v_room_revision, v_control_revision
    from public.nights
   where id = p_night_id
   for share;

  if not found
     or v_run_id is distinct from p_run_id
     or v_room_revision <> p_room_revision
     or v_control_revision <> p_control_revision then
    return 'mismatch';
  end if;

  select qp.id
    into v_play_id
    from public.question_plays qp
    join public.games g
      on g.id = qp.game_id
     and g.night_id = qp.night_id
     and g.state = 'live'
   where qp.night_id = p_night_id
     and qp.run_id = p_run_id
     and qp.status <> 'undone'
   order by qp.opened_at desc, qp.id desc
   limit 1;

  if v_play_id is distinct from p_play_id then
    return 'mismatch';
  end if;

  select *
    into v_existing
    from public.surface_observations
   where night_id = p_night_id
     and surface_kind = p_surface_kind
     and subject_key = p_subject_key
   for update;

  if found then
    if v_existing.run_id = p_run_id
       and (v_existing.room_revision > p_room_revision
         or v_existing.control_revision > p_control_revision) then
      return 'stale';
    end if;
    if v_existing.run_id is not distinct from p_run_id
       and v_existing.room_revision = p_room_revision
       and v_existing.control_revision = p_control_revision
       and v_existing.play_id is not distinct from p_play_id
       and v_existing.observed_at > v_now - interval '1 second' then
      return 'rate_limited';
    end if;
  end if;

  insert into public.surface_observations (
    night_id, surface_kind, subject_key, run_id,
    room_revision, control_revision, play_id, observed_at
  ) values (
    p_night_id, p_surface_kind, p_subject_key, p_run_id,
    p_room_revision, p_control_revision, p_play_id, v_now
  )
  on conflict (night_id, surface_kind, subject_key) do update
    set run_id = excluded.run_id,
        room_revision = excluded.room_revision,
        control_revision = excluded.control_revision,
        play_id = excluded.play_id,
        observed_at = excluded.observed_at;

  -- Trusted writes opportunistically enforce the five-minute retention
  -- boundary, avoiding public cron or a browser-callable cleanup surface.
  delete from public.surface_observations
   where observed_at < v_now - interval '5 minutes';

  return 'accepted';
end;
$$;

revoke all privileges
on function public.observe_surface_delivery(uuid, text, text, uuid, bigint, bigint, uuid)
from public, anon, authenticated;

grant execute
on function public.observe_surface_delivery(uuid, text, text, uuid, bigint, bigint, uuid)
to service_role;

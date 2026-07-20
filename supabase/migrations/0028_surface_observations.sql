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

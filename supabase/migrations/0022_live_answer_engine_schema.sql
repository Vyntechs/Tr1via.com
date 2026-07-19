-- 0022_live_answer_engine_schema.sql
--
-- Add the durable run/play records used by the resilient live-answer engine.
-- This migration is additive and does not enable the engine for any host or
-- existing night. Every mutation table remains service-role-only; audience
-- surfaces may observe only the allowlisted aggregate room-event stream.

set search_path = public, extensions;

-- A normal signed-device player can answer. Host-created roster names are
-- explicitly marked score-only by their server route.
alter table public.players
  add column can_answer boolean not null default true;

-- The engine is latched when a night opens. Existing rows remain on the
-- legacy path, and no run is created by this schema-only migration.
alter table public.nights
  add column answer_engine text not null default 'legacy'
    check (answer_engine in ('legacy', 'resilient_v1')),
  add column answer_engine_latched_at timestamptz,
  add column current_run_id uuid,
  add column room_revision bigint not null default 0,
  add column control_revision bigint not null default 0;

alter table public.nights
  add constraint nights_room_revision_nonnegative
    check (room_revision >= 0),
  add constraint nights_control_revision_nonnegative
    check (control_revision >= 0);

-- Server-owned rollout control. A host-facing route may update this table
-- only through the service role after separately authenticating ownership.
create table public.host_answer_engine_settings (
  host_id uuid primary key references public.hosts(id) on delete cascade,
  release_enabled boolean not null default false,
  preferred_engine text not null default 'legacy'
    check (preferred_engine in ('legacy', 'resilient_v1')),
  updated_at timestamptz not null default now()
);

-- One immutable play identity per reveal. The status and deadline fields are
-- advanced only by the authoritative service-role functions added in 0023.
create table public.question_plays (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.nights(id) on delete cascade,
  run_id uuid not null,
  game_id uuid not null references public.games(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  status text not null default 'accepting'
    check (status in ('accepting', 'all_in_hold', 'final_window', 'resolved', 'undone')),
  opened_at timestamptz not null,
  main_zero_at timestamptz not null,
  final_window_starts_at timestamptz,
  final_window_ends_at timestamptz not null,
  finalize_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  eligible_count integer not null default 0,
  confirmed_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint question_plays_counts_valid check (
    eligible_count >= 0
    and confirmed_count >= 0
    and confirmed_count <= eligible_count
  )
);

-- A run may have only one currently active play, and a question may be
-- replayed in that run only after its previous play was explicitly undone.
create unique index question_plays_one_unfinished_per_run_idx
  on public.question_plays (run_id)
  where status in ('accepting', 'all_in_hold', 'final_window');

create unique index question_plays_one_non_undone_per_question_idx
  on public.question_plays (run_id, question_id)
  where status <> 'undone';

create index question_plays_night_run_idx
  on public.question_plays (night_id, run_id, opened_at desc);

create index question_plays_game_idx
  on public.question_plays (game_id, opened_at desc);

-- Frozen when the question opens. Late joins cannot be inserted implicitly
-- through the answer table because the answer FK targets this exact pair.
create table public.question_play_eligibility (
  play_id uuid not null references public.question_plays(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  frozen_at timestamptz not null default now(),
  primary key (play_id, player_id)
);

-- The first accepted choice is canonical for one eligible player/play pair.
-- Both receipt and lock times are database-authored by the 0023 RPC.
create table public.question_play_answers (
  play_id uuid not null,
  player_id uuid not null,
  submission_id uuid not null,
  visible_slot smallint not null check (visible_slot between 1 and 4),
  canonical_index smallint not null check (canonical_index between 0 and 3),
  received_at timestamptz not null,
  locked_at timestamptz not null,
  ms_to_lock integer not null check (ms_to_lock >= 0),
  is_correct boolean,
  awarded_points integer,
  primary key (play_id, player_id),
  constraint question_play_answers_eligible_fk
    foreign key (play_id, player_id)
    references public.question_play_eligibility(play_id, player_id)
    on delete cascade
);

create index question_play_answers_submission_idx
  on public.question_play_answers (play_id, submission_id);

-- Per-player attempt buckets are updated in place by the submit RPC.
create table public.question_play_attempt_windows (
  play_id uuid not null,
  player_id uuid not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  primary key (play_id, player_id),
  constraint question_play_attempt_windows_eligible_fk
    foreign key (play_id, player_id)
    references public.question_play_eligibility(play_id, player_id)
    on delete cascade
);

-- A coarse shared bucket bounds public deadline checks while leaving room for
-- a forty-player reconnect surge. The exact threshold is enforced by 0023.
create table public.play_finalize_attempt_windows (
  play_id uuid primary key references public.question_plays(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

-- Durable idempotency receipts outlive play transitions. Expected IDs are
-- nullable because some lifecycle commands have no current game or play.
create table public.live_command_receipts (
  night_id uuid not null references public.nights(id) on delete cascade,
  command_id uuid not null,
  run_id uuid not null,
  kind text not null,
  request_hash text not null,
  expected_control_revision bigint not null,
  expected_game_id uuid references public.games(id) on delete set null,
  expected_play_id uuid references public.question_plays(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected')),
  canonical_result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (night_id, command_id),
  constraint live_command_receipts_expected_revision_nonnegative
    check (expected_control_revision >= 0)
);

-- The only new table published through Realtime. Payloads are restricted to
-- audience-safe aggregate state; no player, device, submission, or choice
-- identity belongs here.
create table public.live_room_events (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.nights(id) on delete cascade,
  run_id uuid not null,
  play_id uuid references public.question_plays(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  room_revision bigint not null check (room_revision >= 0),
  control_revision bigint not null check (control_revision >= 0),
  kind text not null check (kind in (
    'night_opened',
    'game_started',
    'play_opened',
    'answer_progress',
    'final_window_started',
    'play_resolved',
    'play_undone',
    'game_ended',
    'night_reset'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (night_id, run_id, room_revision)
);

create index live_room_events_night_revision_idx
  on public.live_room_events (night_id, run_id, room_revision desc);

-- RLS is defense in depth. There are deliberately no browser policies;
-- service_role bypasses RLS and is the sole grantee below.
alter table public.host_answer_engine_settings enable row level security;
alter table public.live_command_receipts enable row level security;
alter table public.question_plays enable row level security;
alter table public.question_play_eligibility enable row level security;
alter table public.question_play_answers enable row level security;
alter table public.question_play_attempt_windows enable row level security;
alter table public.play_finalize_attempt_windows enable row level security;
alter table public.live_room_events enable row level security;

revoke all privileges on table
  public.host_answer_engine_settings,
  public.live_command_receipts,
  public.question_plays,
  public.question_play_eligibility,
  public.question_play_answers,
  public.question_play_attempt_windows,
  public.play_finalize_attempt_windows,
  public.live_room_events
from public, anon, authenticated;

grant all privileges on table
  public.host_answer_engine_settings,
  public.live_command_receipts,
  public.question_plays,
  public.question_play_eligibility,
  public.question_play_answers,
  public.question_play_attempt_windows,
  public.play_finalize_attempt_windows,
  public.live_room_events
to service_role;

alter publication supabase_realtime add table public.live_room_events;

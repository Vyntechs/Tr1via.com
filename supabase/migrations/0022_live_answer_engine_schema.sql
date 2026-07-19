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
    check (control_revision >= 0),
  add constraint nights_current_run_identity
    unique (id, current_run_id),
  add constraint nights_current_run_unique
    unique (current_run_id);

-- Composite identities let every authoritative child prove its ancestry
-- without trusting a route or a later RPC to join the hierarchy correctly.
alter table public.games
  add constraint games_night_identity unique (id, night_id);

alter table public.categories
  add constraint categories_game_identity unique (id, game_id);

alter table public.questions
  add constraint questions_category_identity unique (id, category_id);

alter table public.players
  add constraint players_night_identity unique (id, night_id);

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
  night_id uuid not null,
  run_id uuid not null,
  game_id uuid not null,
  category_id uuid not null,
  question_id uuid not null,
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
  ),
  constraint question_plays_chronology_valid check (
    main_zero_at > opened_at
    and final_window_ends_at > opened_at
    and (final_window_starts_at is null or (
      final_window_starts_at >= opened_at
      and final_window_starts_at < final_window_ends_at
    ))
    and (finalize_at is null or finalize_at >= opened_at + interval '2 seconds')
    and (resolved_at is null or resolved_at >= opened_at)
    and ((status = 'resolved') = (resolved_at is not null))
    and ((status = 'resolved') = (resolution_reason is not null))
  ),
  constraint question_plays_night_run_fk
    foreign key (night_id, run_id)
    references public.nights(id, current_run_id)
    on delete cascade,
  constraint question_plays_game_night_fk
    foreign key (game_id, night_id)
    references public.games(id, night_id)
    on delete cascade,
  constraint question_plays_category_game_fk
    foreign key (category_id, game_id)
    references public.categories(id, game_id)
    on delete cascade,
  constraint question_plays_question_category_fk
    foreign key (question_id, category_id)
    references public.questions(id, category_id)
    on delete cascade,
  constraint question_plays_play_night_identity
    unique (id, night_id),
  constraint question_plays_receipt_identity
    unique (id, night_id, run_id, game_id),
  constraint question_plays_event_identity
    unique (id, night_id, run_id, game_id, question_id)
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

create index question_plays_category_idx
  on public.question_plays (category_id, opened_at desc);

create index question_plays_question_idx
  on public.question_plays (question_id, opened_at desc);

-- Frozen when the question opens. Late joins cannot be inserted implicitly
-- through the answer table because the answer FK targets this exact pair.
create table public.question_play_eligibility (
  play_id uuid not null,
  player_id uuid not null,
  night_id uuid not null,
  frozen_at timestamptz not null default now(),
  primary key (play_id, player_id),
  constraint question_play_eligibility_play_night_fk
    foreign key (play_id, night_id)
    references public.question_plays(id, night_id)
    on delete cascade,
  constraint question_play_eligibility_player_night_fk
    foreign key (player_id, night_id)
    references public.players(id, night_id)
    on delete cascade
);

create index question_play_eligibility_player_idx
  on public.question_play_eligibility (player_id, night_id);

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
  -- Written once by the authoritative answer RPC after its matching event.
  -- Nullable only for pre-canonical/backfill rows; browser roles have no access.
  canonical_result jsonb,
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

create index question_play_attempt_windows_player_idx
  on public.question_play_attempt_windows (player_id, play_id);

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
  night_id uuid not null,
  command_id uuid not null,
  run_id uuid not null,
  kind text not null,
  request_hash text not null,
  expected_control_revision bigint not null,
  expected_game_id uuid,
  expected_play_id uuid,
  expected_play_status text check (expected_play_status in (
    'accepting', 'all_in_hold', 'final_window', 'resolved', 'undone'
  )),
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected')),
  canonical_result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (night_id, command_id),
  constraint live_command_receipts_expected_revision_nonnegative
    check (expected_control_revision >= 0),
  constraint live_command_receipts_expected_play_shape check (
    (expected_play_id is null and expected_play_status is null)
    or
    (expected_play_id is not null
      and expected_game_id is not null
      and expected_play_status is not null)
  ),
  constraint live_command_receipts_night_run_fk
    foreign key (night_id, run_id)
    references public.nights(id, current_run_id)
    on delete cascade,
  constraint live_command_receipts_game_night_fk
    foreign key (expected_game_id, night_id)
    references public.games(id, night_id),
  constraint live_command_receipts_play_ancestry_fk
    foreign key (expected_play_id, night_id, run_id, expected_game_id)
    references public.question_plays(id, night_id, run_id, game_id)
);

create index live_command_receipts_expected_game_idx
  on public.live_command_receipts (expected_game_id, night_id);

create index live_command_receipts_expected_play_idx
  on public.live_command_receipts (expected_play_id, night_id, run_id);

-- The only new table published through Realtime. Payloads are restricted to
-- audience-safe aggregate state; no player, device, submission, or choice
-- identity belongs here.
create table public.live_room_events (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null,
  run_id uuid not null,
  play_id uuid,
  game_id uuid,
  question_id uuid,
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
  unique (night_id, run_id, room_revision),
  constraint live_room_events_shape_valid check (
    (kind in ('night_opened', 'night_reset')
      and play_id is null and game_id is null and question_id is null)
    or
    (kind in ('game_started', 'game_ended')
      and play_id is null and game_id is not null and question_id is null)
    or
    (kind in (
      'play_opened', 'answer_progress', 'final_window_started',
      'play_resolved', 'play_undone'
    ) and play_id is not null and game_id is not null and question_id is not null)
  ),
  constraint live_room_events_night_run_fk
    foreign key (night_id, run_id)
    references public.nights(id, current_run_id)
    on delete cascade,
  constraint live_room_events_game_night_fk
    foreign key (game_id, night_id)
    references public.games(id, night_id)
    on delete cascade,
  constraint live_room_events_play_ancestry_fk
    foreign key (play_id, night_id, run_id, game_id, question_id)
    references public.question_plays(id, night_id, run_id, game_id, question_id)
    on delete cascade
);

create index live_room_events_night_revision_idx
  on public.live_room_events (night_id, run_id, room_revision desc);

create index live_room_events_play_idx
  on public.live_room_events (play_id, night_id, run_id);

create index live_room_events_game_idx
  on public.live_room_events (game_id, night_id);

create index live_room_events_question_idx
  on public.live_room_events (question_id, play_id);

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

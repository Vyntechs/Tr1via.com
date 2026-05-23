-- 0001_init.sql — TR1VIA schema bootstrap.
--
-- One night per evening. Each night holds two games (a fresh board each).
-- Each game has six categories of seven questions at 100..700 pts. Players
-- are device-bound (cookie UUID) and join a night once; per-game opt-in
-- via game_participations. Answers carry the scramble the player saw, and
-- get scored at T+20 by a stored procedure that flips played → resolved.
--
-- Source of truth: tr1via-plan.md (the rules).
-- Plan ref: docs/superpowers/plans/2026-05-23-tr1via.md, Phase 3 Task 3.2.

set search_path = public;

-- ─── hosts ──────────────────────────────────────────────────────────────
create table hosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  display_name text not null,
  default_venue text,
  is_first_night_complete boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── venues ─────────────────────────────────────────────────────────────
create table venues (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references hosts on delete cascade,
  name text not null,
  brand_color text,
  created_at timestamptz not null default now()
);
create index venues_host_idx on venues (host_id);

-- ─── nights ─────────────────────────────────────────────────────────────
-- One persistent room per evening. Holds both games of the night.
create table nights (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references hosts on delete cascade,
  venue_name text not null,            -- denormalized so deleted venues don't break recap
  room_code text not null unique,      -- "K9PR4M" stored; "K9·PR4M" for display
  theme_key text not null default 'house',
  is_locked boolean not null default false,  -- host's "lock the game" toggle
  scheduled_at timestamptz,
  opened_at timestamptz,               -- when host opened the room
  closed_at timestamptz,               -- when host ended the night
  created_at timestamptz not null default now()
);
create unique index nights_room_code_active_idx
  on nights (room_code) where closed_at is null;
create index nights_host_idx on nights (host_id, scheduled_at desc);

-- ─── games ──────────────────────────────────────────────────────────────
-- Game 1 and Game 2 within a night. Each a fresh board, scores from 0.
create table games (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references nights on delete cascade,
  game_no smallint not null check (game_no between 1 and 2),
  category_count smallint not null default 6,
  question_count smallint not null default 7,
  state text not null default 'draft'
    check (state in ('draft','ready','live','done')),
  started_at timestamptz,
  ended_at timestamptz,
  unique (night_id, game_no)
);
create index games_night_idx on games (night_id);

-- ─── categories ─────────────────────────────────────────────────────────
-- A topic on the Jeopardy grid. Six per game by default.
create table categories (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  name text not null,
  topic text not null,                 -- the prompt the host typed
  position smallint not null,          -- column 0..5
  color text,                          -- nullable; defaults to the category map color
  state text not null default 'draft'  -- draft | generating | review | ready
    check (state in ('draft','generating','review','ready')),
  flavor jsonb,                        -- {difficulty: 'normal', tweaks: ['sharper']}
  created_at timestamptz not null default now()
);
create index categories_game_idx on categories (game_id, position);

-- ─── questions ──────────────────────────────────────────────────────────
-- The 20 generated + the 7 picked, all stored. `point_value` is null until
-- picked + assigned via assignPointValues(); `played_at` is null until
-- revealed; `finished_at` is null until resolved.
create table questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories on delete cascade,
  point_value smallint check (point_value is null or point_value in (100,200,300,400,500,600,700)),
  prompt text not null,
  options jsonb not null,              -- ["Florida","Alaska","California","Maine"]
  correct_index smallint not null check (correct_index between 0 and 3),
  image_url text,
  image_attribution text,
  image_source text,                   -- 'pexels' | 'upload' | null
  difficulty smallint not null default 4 check (difficulty between 1 and 7),
  source text not null default 'ai'
    check (source in ('ai','host-edit')),
  is_picked boolean not null default false,
  fact_blurb text,                     -- "33,904 miles of tidal coastline…"
  played_at timestamptz,               -- when host pressed Reveal
  finished_at timestamptz,             -- when timer expired or host ended early
  unique (category_id, point_value) deferrable initially deferred
);
create index questions_play_idx on questions (category_id, played_at);
create index questions_picked_idx on questions (category_id, is_picked);

-- ─── players ────────────────────────────────────────────────────────────
-- A device session that joined a night. Identified by a cookie UUID; the
-- same device joining the same night returns the existing row.
create table players (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references nights on delete cascade,
  device_id uuid not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  app_switch_total_seconds integer not null default 0,
  removed_at timestamptz,              -- host removed them mid-night
  unique (night_id, device_id)
);
create index players_night_idx on players (night_id, joined_at);

-- ─── game_participations ────────────────────────────────────────────────
-- Per-game opt-in. Player must tap "Join Game 2" to participate.
create table game_participations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  player_id uuid not null references players on delete cascade,
  joined_at timestamptz not null default now(),
  unique (game_id, player_id)
);
create index participations_game_idx on game_participations (game_id);

-- ─── answers ────────────────────────────────────────────────────────────
-- One per (question, player). is_correct + awarded_points are filled in
-- by resolve_question() at T+20 (or host end-early). chosen_index is the
-- canonical option index the player selected (already de-scrambled).
create table answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions on delete cascade,
  player_id uuid not null references players on delete cascade,
  chosen_index smallint not null check (chosen_index between 0 and 3),
  scramble jsonb not null,             -- the 4-element permutation the phone saw
  locked_at timestamptz not null default now(),
  ms_to_lock integer not null,         -- locked_at - questions.played_at, in ms
  is_correct boolean,                  -- null until resolved
  awarded_points integer,              -- null until resolved
  unique (question_id, player_id)
);
create index answers_q_idx on answers (question_id, locked_at);

-- ─── reveals ────────────────────────────────────────────────────────────
-- Append-only log of host events. TV and phones subscribe to inserts here
-- to learn when something happened — the broadcast carries metadata.
create table reveals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  question_id uuid not null references questions on delete cascade,
  event text not null check (event in ('reveal','undo','end-early','resolve')),
  occurred_at timestamptz not null default now(),
  metadata jsonb
);
create index reveals_game_time_idx on reveals (game_id, occurred_at);

-- ─── adjustments ────────────────────────────────────────────────────────
-- Host hand-adjusts a player's points (e.g. suspected cheating).
create table adjustments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players on delete cascade,
  game_id uuid not null references games on delete cascade,
  delta integer not null,
  reason text,
  created_at timestamptz not null default now()
);
create index adjustments_player_idx on adjustments (player_id, game_id);

-- ─── topic_suggestions ──────────────────────────────────────────────────
-- Players can submit topic ideas from the lobby/recap. Host sees a tally
-- when picking categories for the next night.
create table topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
create index topic_suggestions_search_idx
  on topic_suggestions using gin (to_tsvector('english', text));

-- ─── audience_topic_votes (optional, v1.1) ──────────────────────────────
-- Future: host can run an audience vote at the start of a night. Schema
-- placeholder so we don't migrate again later.
create table audience_topic_votes (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references nights on delete cascade,
  player_id uuid not null references players on delete cascade,
  topic text not null,
  voted_at timestamptz not null default now(),
  unique (night_id, player_id, topic)
);

-- ─── views ──────────────────────────────────────────────────────────────
-- Per-game leaderboard. Sum of awarded_points + adjustments per player.
-- A view (not materialized) since boards are small and writes frequent.
create or replace view game_scores as
  select
    gp.game_id,
    p.id as player_id,
    p.display_name,
    coalesce(sum(a.awarded_points), 0)
      + coalesce(
          (select sum(adj.delta)
             from adjustments adj
            where adj.player_id = p.id
              and adj.game_id = gp.game_id), 0)
      as score,
    count(a.*) filter (where a.is_correct) as correct_count,
    count(a.*) as answered_count,
    min(a.ms_to_lock) filter (where a.is_correct) as fastest_correct_ms
  from game_participations gp
  join players p on p.id = gp.player_id
  left join answers a on a.player_id = p.id
  left join questions q on q.id = a.question_id
  left join categories c on c.id = q.category_id and c.game_id = gp.game_id
  group by gp.game_id, p.id, p.display_name;

-- ─── helpers ────────────────────────────────────────────────────────────

-- Resolve a question (T+20 or host end-early). Called via RPC. Idempotent.
-- Sets is_correct + awarded_points for every answer, marks the question
-- finished, and inserts a 'resolve' event.
create or replace function resolve_question(p_question_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  q record;
begin
  select id, category_id, correct_index, point_value, played_at, finished_at
    into q
    from questions
   where id = p_question_id
   for update;

  if q.id is null then
    raise exception 'question % not found', p_question_id;
  end if;
  if q.finished_at is not null then
    return;  -- idempotent
  end if;
  if q.played_at is null then
    raise exception 'question % was never revealed', p_question_id;
  end if;

  update answers
     set is_correct = (chosen_index = q.correct_index),
         awarded_points = case
           when chosen_index = q.correct_index and ms_to_lock < 5000
             then floor(coalesce(q.point_value, 0) * 1.1)::int
           when chosen_index = q.correct_index
             then coalesce(q.point_value, 0)
           else 0
         end
   where question_id = q.id;

  update questions set finished_at = now() where id = q.id;

  insert into reveals (game_id, question_id, event, metadata)
  select c.game_id, q.id, 'resolve',
         jsonb_build_object(
           'correct_index', q.correct_index,
           'point_value', q.point_value)
    from categories c where c.id = q.category_id;
end;
$$;

-- 0017_room_magic_v1.sql — optional bounded post-reveal room reactions.
--
-- Room Magic is default-off and cosmetic. The receipt table is server-only:
-- players submit through the API, the API enforces one reaction per reveal,
-- and no client reads this table directly.

alter table public.nights
  add column if not exists room_magic_enabled boolean not null default false;

create table if not exists public.room_magic_reactions (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.nights(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('applause', 'nice_one', 'wow', 'brutal')),
  moment text not null default 'reveal' check (moment = 'reveal'),
  created_at timestamptz not null default now(),
  unique (question_id, player_id, moment)
);

create index if not exists room_magic_reactions_night_created_idx
  on public.room_magic_reactions (night_id, created_at desc);

create index if not exists room_magic_reactions_question_kind_idx
  on public.room_magic_reactions (question_id, kind);

create index if not exists room_magic_reactions_player_created_idx
  on public.room_magic_reactions (player_id, created_at desc);

alter table public.room_magic_reactions enable row level security;

revoke all on public.room_magic_reactions from anon;
revoke all on public.room_magic_reactions from authenticated;
grant all on public.room_magic_reactions to service_role;

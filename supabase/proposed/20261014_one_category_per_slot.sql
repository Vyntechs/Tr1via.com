-- PROPOSED, NOT APPLIED. This file lives outside supabase/migrations on purpose
-- so nothing runs it by accident. To use it: review, pick a day with no show,
-- run the read-only listing at the bottom first and read it, then move this
-- into supabase/migrations with a fresh timestamp and apply it.
--
-- One category per board slot.
--
-- Why: a game has six slots (position 1..6) and each must hold one category.
-- The create route used to look for an existing row by EXACT topic text, so a
-- host who came back to a filled slot's topic form and typed the topic again
-- with different capitals got a second row in the same slot. On 2026-10-07 the
-- extra row ("Legendary Ghost stories", never locked) showed on the TV board as
-- a full column of dead tiles next to the real "Ghost Stories". The route is
-- fixed; this adds the database rule so it cannot happen again by any path.
--
-- The board guard from 0031 (fence_category_authoring) refuses to insert,
-- change or delete a category once its game is 'live' or 'done'. That guard
-- stays exactly as it is. This file never turns it off, never works around it,
-- and never edits a row in a started or finished game.
--
-- What it does, in one transaction:
--   1. Ranks the rows of every doubled slot with the order every screen
--      already uses (most picked questions, then more finished state, then
--      newest, then id; the same rule as lib/host/oneCategoryPerSlot.ts).
--      Rank 1 is the row the screens show.
--   2. Deletes a lower-ranked row ONLY when its game has not started
--      (games.state not 'live'/'done', the exact test the guard uses) AND the
--      row has no picked questions, no played questions and no live-engine
--      plays, so nothing on the board, no score and no answer goes.
--      The delete DOES take with it:
--        - the row's unpicked candidate questions (usually about 20; writing
--          them cost AI money and they cannot be brought back),
--        - its question_generation_jobs row (cascade),
--      and its question_generation_reports rows stay but lose their category
--      link (set null). Run the read-only listing at the bottom first to see
--      exactly which rows and how many questions that is.
--   3. Leaves lower-ranked rows in started or finished games ('live'/'done')
--      exactly as they are. The guard would refuse to delete them, and they
--      are history. The screens already show only the rank-1 row.
--   4. Stops with an error (nothing changes) if a game that has not started
--      still has a doubled slot, which means both rows have picks or plays.
--      A person decides which one to keep and deletes the other first: on the
--      setup screen, or by id while that game is still in setup.
--   5. Adds a unique index on (game_id, position) that covers every row except
--      the lower-ranked rows kept in step 3. Each kept rank-1 row is in the
--      index, so a NEW second row in any slot, doubled before or not, gets a
--      duplicate-key error (23505). The app already turns that into "slot
--      already filled".
--
-- Known gap: the rows skipped in step 3 are not in the index. If one of those
-- games is ever reset back to setup and the host then deletes the rank-1 row,
-- the hidden row becomes the slot's only row and only the app's create route
-- (which checks the slot) stops a second row there.
--
-- Locks: first thing, it locks the categories and questions tables in SHARE
-- ROW EXCLUSIVE mode until it commits. Reads carry on, but nobody else can add,
-- change, pick or delete a category or question while it runs, so the ranking
-- in step 1 and the "nothing picked or played" checks in step 2 cannot go stale
-- before the delete (for example a build auto-picking questions on a row that
-- is about to be deleted). Both tables are locked because picks live on
-- questions, not on categories. If either lock is not free within 5 seconds it
-- stops and changes nothing. The guard also takes each game row with NOWAIT,
-- so a write to the same game at that moment makes it fail and roll back
-- instead of waiting. Run it with no show in progress.

begin;

set local lock_timeout = '5s';

lock table public.categories, public.questions in share row exclusive mode;

create temp table one_per_slot_ranked on commit drop as
with picked as (
  select q.category_id, count(*) as picked_count
  from public.questions q
  where q.is_picked
  group by q.category_id
)
select
  c.id,
  c.game_id,
  c.position,
  g.state as game_state,
  row_number() over (
    partition by c.game_id, c.position
    order by
      coalesce(p.picked_count, 0) desc,
      case c.state when 'ready' then 3 when 'review' then 2 when 'generating' then 1 else 0 end desc,
      c.created_at desc,
      c.id desc
  ) as slot_rank
from public.categories c
join public.games g on g.id = c.game_id
left join picked p on p.category_id = c.id;

-- Step 2: only games that have not started, only rows with nothing to lose.
delete from public.categories c
using one_per_slot_ranked r
where c.id = r.id
  and r.slot_rank > 1
  and r.game_state not in ('live', 'done')
  and not exists (
    select 1 from public.questions q
    where q.category_id = r.id
      and (q.is_picked or q.played_at is not null)
  )
  and not exists (
    select 1 from public.question_plays qp
    where qp.category_id = r.id
  );

do $$
declare
  v_blocked text;
  v_left_alone uuid[];
begin
  -- Step 4: a not-started game that is still doubled needs a person.
  select string_agg(r.game_id || ' slot ' || r.position || ': ' || r.id, '; ' order by r.game_id, r.position, r.id)
    into v_blocked
    from one_per_slot_ranked r
    join public.categories c on c.id = r.id
   where r.slot_rank > 1
     and r.game_state not in ('live', 'done');
  if v_blocked is not null then
    raise exception using
      message = 'one category per slot: these rows still double a slot in a game that has not started, and they have picks or plays: ' || v_blocked,
      hint = 'Delete the one to drop (setup screen, or by id while the game is in setup), then run this again. Nothing was changed.';
  end if;

  -- Step 3: rows in started or finished games stay as they are.
  select coalesce(array_agg(r.id order by r.id), '{}'::uuid[])
    into v_left_alone
    from one_per_slot_ranked r
    join public.categories c on c.id = r.id
   where r.slot_rank > 1;

  -- Step 5.
  if cardinality(v_left_alone) = 0 then
    create unique index categories_one_per_slot
      on public.categories (game_id, position);
  else
    execute format(
      'create unique index categories_one_per_slot on public.categories (game_id, position) where id <> all (%L::uuid[])',
      v_left_alone
    );
    raise notice 'one category per slot: left % row(s) in started or finished games as they are: %',
      cardinality(v_left_alone), v_left_alone;
  end if;
end;
$$;

commit;

-- Run this on its own first (read-only). It lists every doubled slot, with
-- each row's state, picked count and the game's state:
-- select c.game_id, g.state as game_state, c.position,
--        array_agg(c.id || ' ' || c.state || ' picked=' ||
--          (select count(*) from public.questions q where q.category_id = c.id and q.is_picked)
--          || ' ' || c.name order by c.created_at)
-- from public.categories c join public.games g on g.id = c.game_id
-- group by c.game_id, g.state, c.position having count(*) > 1;

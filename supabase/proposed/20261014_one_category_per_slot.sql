-- PROPOSED, NOT APPLIED. This file lives outside supabase/migrations on purpose
-- so nothing runs it by accident. To use it: review, pick a day with no show,
-- move it into supabase/migrations with a fresh timestamp, and apply it.
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
-- What it does, in one transaction:
--   1. For every doubled slot, keeps the row every screen already shows
--      (most picked questions first, then more finished state, then newest,
--      then id; the same rule as lib/host/oneCategoryPerSlot.ts). So a filled
--      older row is kept and a newer empty one is the one removed.
--   2. Deletes the other rows ONLY when nothing would be lost: no picked
--      questions, no played questions, no live-engine plays. (Deleting a category also deletes
--      its questions, plays and answers.)
--   3. Adds a unique index on (game_id, position).
-- If any doubled slot still has a row that cannot be removed safely, step 3
-- fails, the whole transaction rolls back, and nothing changes. Those slots
-- need a person to decide which row to keep (query at the bottom).

begin;

with picked as (
  select q.category_id, count(*) as picked_count
  from public.questions q
  where q.is_picked
  group by q.category_id
),
ranked as (
  select
    c.id,
    row_number() over (
      partition by c.game_id, c.position
      order by
        coalesce(p.picked_count, 0) desc,
        case c.state when 'ready' then 3 when 'review' then 2 when 'generating' then 1 else 0 end desc,
        c.created_at desc,
        c.id desc
    ) as slot_rank
  from public.categories c
  left join picked p on p.category_id = c.id
),
losers as (
  select r.id
  from ranked r
  where r.slot_rank > 1
    and not exists (
      select 1 from public.questions q
      where q.category_id = r.id
        and (q.is_picked or q.played_at is not null)
    )
    and not exists (
      select 1 from public.question_plays qp
      where qp.category_id = r.id
    )
)
delete from public.categories c
using losers l
where c.id = l.id;

create unique index categories_one_per_slot
  on public.categories (game_id, position);

commit;

-- Slots that still need a decision (run on its own, read-only):
-- select game_id, position, array_agg(id || ' ' || state || ' ' || name order by created_at)
-- from public.categories group by game_id, position having count(*) > 1;

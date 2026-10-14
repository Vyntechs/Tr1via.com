-- PROPOSED, NOT APPLIED. Run only with Brandon's OK, never during a show.
--
-- One-time cleanup: delete EMPTY twin nights left by repeated taps.
--
-- A night is deleted only when ALL of these are true:
--   - it was never opened, closed or run (opened_at, closed_at,
--     current_run_id all empty) and is not locked;
--   - both of its games are still draft and never started;
--   - nothing hangs off it: no categories, players, plays, generation jobs or
--     reports, topic votes, live runs/events/receipts or reactions;
--   - the same host has ANOTHER night created within 10 minutes of it that
--     is either not empty, or is newer. So in every cluster of near-identical
--     nights exactly one survives (the one with content, else the newest),
--     and a lone empty night (e.g. one made on purpose weeks ago) is kept.
--
-- Deleting a night cascades only to its two empty draft game shells.
--
-- Step 1 (dry run, read-only): run the SELECT at the bottom by itself and
-- check the list. As of 2026-10-14 it should list Heather's 14a0091e and a
-- handful of May-July test nights on host 60fe578c.
-- Step 2: run the whole file; it deletes inside one transaction and prints
-- how many rows it removed.

begin;

create temporary table empty_nights on commit drop as
select n.id, n.host_id, n.created_at
  from nights n
 where n.opened_at is null
   and n.closed_at is null
   and n.current_run_id is null
   and n.is_locked = false
   and not exists (select 1 from games g where g.night_id = n.id
                    and (g.state <> 'draft' or g.started_at is not null))
   and not exists (select 1 from games g join categories c on c.game_id = g.id
                    where g.night_id = n.id)
   and not exists (select 1 from players p where p.night_id = n.id)
   and not exists (select 1 from question_plays x where x.night_id = n.id)
   and not exists (select 1 from question_generation_jobs x where x.night_id = n.id)
   and not exists (select 1 from question_generation_reports x where x.night_id = n.id)
   and not exists (select 1 from audience_topic_votes x where x.night_id = n.id)
   and not exists (select 1 from live_night_runs x where x.night_id = n.id)
   and not exists (select 1 from live_room_events x where x.night_id = n.id)
   and not exists (select 1 from live_command_receipts x where x.night_id = n.id)
   and not exists (select 1 from room_magic_reactions x where x.night_id = n.id);

create temporary table twin_nights_to_delete on commit drop as
select e.id
  from empty_nights e
 where exists (
         select 1
           from nights m
          where m.host_id = e.host_id
            and m.id <> e.id
            and abs(extract(epoch from (m.created_at - e.created_at))) <= 600
            and (
                  m.id not in (select id from empty_nights)  -- has content: keep it, drop e
               or m.created_at > e.created_at                -- both empty: keep the newer
            )
       );

delete from nights n
 using twin_nights_to_delete d
 where n.id = d.id;

select count(*) as empty_twin_nights_deleted from twin_nights_to_delete;

commit;

-- Dry run (read-only). Same rules as above, lists what would be deleted:
--
-- with empty_nights as (
--   select n.id, n.host_id, n.created_at from nights n
--    where n.opened_at is null and n.closed_at is null and n.current_run_id is null
--      and n.is_locked = false
--      and not exists (select 1 from games g where g.night_id = n.id
--                       and (g.state <> 'draft' or g.started_at is not null))
--      and not exists (select 1 from games g join categories c on c.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from players p where p.night_id = n.id)
--      and not exists (select 1 from question_plays x where x.night_id = n.id)
--      and not exists (select 1 from question_generation_jobs x where x.night_id = n.id)
--      and not exists (select 1 from question_generation_reports x where x.night_id = n.id)
--      and not exists (select 1 from audience_topic_votes x where x.night_id = n.id)
--      and not exists (select 1 from live_night_runs x where x.night_id = n.id)
--      and not exists (select 1 from live_room_events x where x.night_id = n.id)
--      and not exists (select 1 from live_command_receipts x where x.night_id = n.id)
--      and not exists (select 1 from room_magic_reactions x where x.night_id = n.id))
-- select e.id, e.host_id, e.created_at from empty_nights e
--  where exists (select 1 from nights m where m.host_id = e.host_id and m.id <> e.id
--                  and abs(extract(epoch from (m.created_at - e.created_at))) <= 600
--                  and (m.id not in (select id from empty_nights) or m.created_at > e.created_at))
--  order by e.created_at;

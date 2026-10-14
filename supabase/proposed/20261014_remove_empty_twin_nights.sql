-- PROPOSED, NOT APPLIED. Run only with Brandon's OK, never during a show.
--
-- One-time cleanup: delete EMPTY twin nights left by repeated taps.
--
-- A night is deleted only when ALL of these are true:
--   - it is more than 1 hour old. Nobody can be in the middle of setting it
--     up, and the app's own reuse rule (which takes no lock until
--     create_night_once is applied) only ever hands back nights under 10
--     minutes old, so it can never be handed to a host while this runs;
--   - it was never opened, closed, run, locked or latched, and its room and
--     control revisions are still 0;
--   - both of its games are still draft and never started;
--   - NOTHING points at it or at its games. Every table with a foreign key
--     to nights or games is checked (step 0 refuses to run if a new one
--     shows up that this file does not know), plus the diagnostic log tables
--     that carry a night_id without a foreign key;
--   - the same host has ANOTHER night created within 10 minutes of it that
--     is either not empty, or is newer. So in every cluster of near-identical
--     nights one survives (the one with content, else the newest), and a lone
--     empty night (e.g. one made on purpose weeks ago) is kept.
--
-- Safe against a host working at the same moment:
--   - it takes the same per-host lock as create_night_once, then locks the
--     night rows and their game rows, so nobody can add a player, topic,
--     vote or TV record to them until it commits;
--   - the DELETE re-checks every rule above in its own WHERE, after the
--     locks, so anything added in between keeps the night;
--   - lock_timeout makes it give up (and roll back) after 5 seconds instead
--     of making anyone wait.
--
-- Deleting a night cascades only to its two empty draft game shells.
--
-- Step 1 (dry run, read-only): run the SELECT at the bottom by itself and
-- check the list. On 2026-10-14 (before the 1-hour floor and the extra
-- checks were added) it listed Heather's 14a0091e and 9 May-July test nights
-- on host 60fe578c; re-run it before step 2.
-- Step 2: run the whole file; it deletes inside one transaction and prints
-- how many rows it removed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 0. Refuse to run if any table points at nights or games that this file
--    does not check. A new table added later must be added below first.
do $$
declare
  v_missing text;
begin
  select string_agg(distinct cl.relname, ', ' order by cl.relname)
    into v_missing
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class p on p.oid = c.confrelid
    join pg_namespace ns on ns.oid = p.relnamespace
   where c.contype = 'f'
     and ns.nspname = 'public'
     and p.relname in ('nights', 'games')
     and cl.relname not in (
           'games', 'categories', 'adjustments', 'game_participations', 'reveals',
           'players', 'audience_topic_votes', 'question_generation_jobs',
           'question_generation_reports', 'question_plays', 'live_night_runs',
           'live_room_events', 'live_command_receipts', 'live_command_receipt_archive',
           'room_magic_reactions', 'surface_observations'
         );
  if v_missing is not null then
    raise exception 'empty twin cleanup stopped: % point at nights or games and are not checked by this file', v_missing;
  end if;
end $$;

-- 1. Every night with nothing in it (any age).
create temporary table empty_nights on commit drop as
select n.id, n.host_id, n.created_at
  from nights n
 where n.opened_at is null
   and n.closed_at is null
   and n.current_run_id is null
   and n.answer_engine_latched_at is null
   and n.is_locked = false
   and n.room_revision = 0
   and n.control_revision = 0
   and not exists (select 1 from games g where g.night_id = n.id
                    and (g.state <> 'draft' or g.started_at is not null))
   and not exists (select 1 from games g join categories x on x.game_id = g.id where g.night_id = n.id)
   and not exists (select 1 from games g join adjustments x on x.game_id = g.id where g.night_id = n.id)
   and not exists (select 1 from games g join game_participations x on x.game_id = g.id where g.night_id = n.id)
   and not exists (select 1 from games g join reveals x on x.game_id = g.id where g.night_id = n.id)
   and not exists (select 1 from games g join question_generation_jobs x on x.game_id = g.id where g.night_id = n.id)
   and not exists (select 1 from games g join question_generation_reports x on x.game_id = g.id where g.night_id = n.id)
   and not exists (select 1 from players x where x.night_id = n.id)
   and not exists (select 1 from audience_topic_votes x where x.night_id = n.id)
   and not exists (select 1 from question_generation_jobs x where x.night_id = n.id)
   and not exists (select 1 from question_generation_reports x where x.night_id = n.id)
   and not exists (select 1 from question_plays x where x.night_id = n.id)
   and not exists (select 1 from question_play_eligibility x where x.night_id = n.id)
   and not exists (select 1 from live_night_runs x where x.night_id = n.id)
   and not exists (select 1 from live_room_events x where x.night_id = n.id)
   and not exists (select 1 from live_command_receipts x where x.night_id = n.id)
   and not exists (select 1 from live_command_receipt_archive x where x.night_id = n.id)
   and not exists (select 1 from room_magic_reactions x where x.night_id = n.id)
   and not exists (select 1 from surface_observations x where x.night_id = n.id)
   and not exists (select 1 from diag_server_actions x where x.night_id = n.id)
   and not exists (select 1 from diag_device_events x where x.night_id = n.id)
   and not exists (select 1 from diag_answer_events x where x.night_id = n.id)
   and not exists (select 1 from diag_quota x where x.night_id = n.id);

-- 2. The ones to delete: empty, over 1 hour old, with a twin that stays.
create temporary table twin_nights_to_delete on commit drop as
select e.id, e.host_id
  from empty_nights e
 where e.created_at < now() - interval '1 hour'
   and exists (
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

-- 3. Same per-host lock as create_night_once (same key), hosts in a fixed
--    order, so no night can be made for these hosts while this runs.
select pg_advisory_xact_lock(hashtextextended('tr1via:create_night:' || h.host_id::text, 0))
  from (select distinct host_id from twin_nights_to_delete order by host_id) h;

-- 4. Lock the night rows and their game rows. Adding a player, topic, vote,
--    TV record etc. needs a lock these block, so nothing new can land on
--    them until commit; anything that landed already is seen by step 5.
select n.id from nights n
 where n.id in (select id from twin_nights_to_delete)
 order by n.id
   for update;
select g.id from games g
 where g.night_id in (select id from twin_nights_to_delete)
 order by g.id
   for update;

-- 5. Delete, re-checking every rule in the delete itself (fresh snapshot,
--    taken after the locks above).
with deleted as (
  delete from nights n
   where n.id in (select id from twin_nights_to_delete)
     and n.created_at < now() - interval '1 hour'
     and n.opened_at is null
     and n.closed_at is null
     and n.current_run_id is null
     and n.answer_engine_latched_at is null
     and n.is_locked = false
     and n.room_revision = 0
     and n.control_revision = 0
     and not exists (select 1 from games g where g.night_id = n.id
                      and (g.state <> 'draft' or g.started_at is not null))
     and not exists (select 1 from games g join categories x on x.game_id = g.id where g.night_id = n.id)
     and not exists (select 1 from games g join adjustments x on x.game_id = g.id where g.night_id = n.id)
     and not exists (select 1 from games g join game_participations x on x.game_id = g.id where g.night_id = n.id)
     and not exists (select 1 from games g join reveals x on x.game_id = g.id where g.night_id = n.id)
     and not exists (select 1 from games g join question_generation_jobs x on x.game_id = g.id where g.night_id = n.id)
     and not exists (select 1 from games g join question_generation_reports x on x.game_id = g.id where g.night_id = n.id)
     and not exists (select 1 from players x where x.night_id = n.id)
     and not exists (select 1 from audience_topic_votes x where x.night_id = n.id)
     and not exists (select 1 from question_generation_jobs x where x.night_id = n.id)
     and not exists (select 1 from question_generation_reports x where x.night_id = n.id)
     and not exists (select 1 from question_plays x where x.night_id = n.id)
     and not exists (select 1 from question_play_eligibility x where x.night_id = n.id)
     and not exists (select 1 from live_night_runs x where x.night_id = n.id)
     and not exists (select 1 from live_room_events x where x.night_id = n.id)
     and not exists (select 1 from live_command_receipts x where x.night_id = n.id)
     and not exists (select 1 from live_command_receipt_archive x where x.night_id = n.id)
     and not exists (select 1 from room_magic_reactions x where x.night_id = n.id)
     and not exists (select 1 from surface_observations x where x.night_id = n.id)
     and not exists (select 1 from diag_server_actions x where x.night_id = n.id)
     and not exists (select 1 from diag_device_events x where x.night_id = n.id)
     and not exists (select 1 from diag_answer_events x where x.night_id = n.id)
     and not exists (select 1 from diag_quota x where x.night_id = n.id)
     and exists (
           select 1
             from nights m
            where m.host_id = n.host_id
              and m.id <> n.id
              and abs(extract(epoch from (m.created_at - n.created_at))) <= 600
              and (m.id not in (select id from empty_nights) or m.created_at > n.created_at)
         )
  returning n.id
)
select count(*) as empty_twin_nights_deleted from deleted;

commit;

-- Dry run (read-only). Same rules as above, lists what would be deleted,
-- with the settings shown so a person can eyeball each one:
--
-- with empty_nights as (
--   select n.id, n.host_id, n.created_at from nights n
--    where n.opened_at is null and n.closed_at is null and n.current_run_id is null
--      and n.answer_engine_latched_at is null and n.is_locked = false
--      and n.room_revision = 0 and n.control_revision = 0
--      and not exists (select 1 from games g where g.night_id = n.id
--                       and (g.state <> 'draft' or g.started_at is not null))
--      and not exists (select 1 from games g join categories x on x.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from games g join adjustments x on x.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from games g join game_participations x on x.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from games g join reveals x on x.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from games g join question_generation_jobs x on x.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from games g join question_generation_reports x on x.game_id = g.id where g.night_id = n.id)
--      and not exists (select 1 from players x where x.night_id = n.id)
--      and not exists (select 1 from audience_topic_votes x where x.night_id = n.id)
--      and not exists (select 1 from question_generation_jobs x where x.night_id = n.id)
--      and not exists (select 1 from question_generation_reports x where x.night_id = n.id)
--      and not exists (select 1 from question_plays x where x.night_id = n.id)
--      and not exists (select 1 from question_play_eligibility x where x.night_id = n.id)
--      and not exists (select 1 from live_night_runs x where x.night_id = n.id)
--      and not exists (select 1 from live_room_events x where x.night_id = n.id)
--      and not exists (select 1 from live_command_receipts x where x.night_id = n.id)
--      and not exists (select 1 from live_command_receipt_archive x where x.night_id = n.id)
--      and not exists (select 1 from room_magic_reactions x where x.night_id = n.id)
--      and not exists (select 1 from surface_observations x where x.night_id = n.id)
--      and not exists (select 1 from diag_server_actions x where x.night_id = n.id)
--      and not exists (select 1 from diag_device_events x where x.night_id = n.id)
--      and not exists (select 1 from diag_answer_events x where x.night_id = n.id)
--      and not exists (select 1 from diag_quota x where x.night_id = n.id))
-- select n.id, n.host_id, n.created_at, n.venue_name, n.theme_key, n.room_magic_enabled
--   from empty_nights e join nights n on n.id = e.id
--  where e.created_at < now() - interval '1 hour'
--    and exists (select 1 from nights m where m.host_id = e.host_id and m.id <> e.id
--                  and abs(extract(epoch from (m.created_at - e.created_at))) <= 600
--                  and (m.id not in (select id from empty_nights) or m.created_at > e.created_at))
--  order by n.created_at;

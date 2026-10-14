-- PROPOSED, NOT APPLIED. Run only with Brandon's OK, never during a show,
-- and only after Brandon has read a fresh dry-run list (bottom of this file).
--
-- One-time cleanup: delete EMPTY twin nights left by a repeated tap.
--
-- This is the SAME rule the host home page uses to hide a leftover twin
-- (lib/host/nightTwins.ts), plus two extra guards. The two are kept in step
-- by tests/integration/remove-empty-twins-full-schema.test.ts, which runs
-- both on the same nights and checks they pick the same ones.
--
-- A night is deleted only when ALL of these are true:
--   - it is still exactly what a tap on the home page button makes. Every
--     column of the night is checked against a brand-new night: venue is the
--     host's default venue (what the button sends), no theme, no date, not
--     locked, room magic off, never opened, closed or run, answer engine still
--     'legacy' and never latched, room and control revisions 0. It has exactly
--     its two game shells (game 1 and game 2), each still 6 topics x 7
--     questions, draft, never started or ended. Step 0 refuses to run if
--     nights or games has a column this file does not check;
--   - NOTHING points at it or at its games: no topics, no players, and every
--     other table with a foreign key to nights or games is empty for it (step
--     0 refuses to run if a new one shows up), plus the diagnostic log tables
--     that carry a night_id without a foreign key;
--   - another night of the same host, at the same venue, was made within 5
--     seconds of it (a repeat tap; Heather's were 1.07 s apart), and that
--     night stays: it is not an untouched empty one, or it is the newer one.
--     So one night of every pair always survives, and two blank nights made
--     on purpose more than 5 seconds apart are both kept;
--   - EXTRA GUARD: it is more than 1 hour old, so nobody can be in the middle
--     of setting it up, and the app's reuse rule (nights under 10 minutes
--     old) can never hand it out while this runs.
--   (The home page cannot check every table; the extra table checks and the
--   1-hour floor only ever make this file keep MORE than the home page hides.)
--
-- Safe against a host working at the same moment:
--   - it takes the same per-host lock as create_night_once, then locks the
--     night rows and their game rows, so nobody can add a player, topic,
--     vote or TV record to them until it commits;
--   - the DELETE re-checks every rule above in its own WHERE (the view
--     twin_nights_removable is read again, after the locks), so anything
--     added in between keeps the night;
--   - lock_timeout makes it give up (and roll back) after 5 seconds instead
--     of making anyone wait.
--
-- Deleting a night cascades only to its two empty draft game shells.
--
-- Step 1 (dry run, read-only): run the SELECT at the bottom by itself and
-- read the list. It now lists fewer nights than the Oct 14 run (Heather's
-- 14a0091e plus 9 test nights): the test host's twins made 5.7 to 30 seconds
-- apart are no longer twins under the 5-second rule.
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

-- 0b. Refuse to run if nights or games has a column this file does not
--     compare with a brand-new night. A new column must be added to the
--     rule below (and to lib/host/nightTwins.ts) first.
do $$
declare
  v_extra text;
begin
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
    into v_extra
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'nights' and column_name not in (
            -- nights columns:
            'id', 'host_id', 'room_code', 'created_at', 'venue_name', 'theme_key',
            'scheduled_at', 'is_locked', 'room_magic_enabled', 'opened_at', 'closed_at',
            'answer_engine', 'answer_engine_latched_at', 'current_run_id',
            'room_revision', 'control_revision'
            -- end nights columns
          ))
       or (table_name = 'games' and column_name not in (
            -- games columns:
            'id', 'night_id', 'game_no', 'category_count', 'question_count', 'state',
            'started_at', 'ended_at'
            -- end games columns
          )));
  if v_extra is not null then
    raise exception 'empty twin cleanup stopped: % not checked by this file', v_extra;
  end if;
end $$;

-- 1. The rule, written once. twin_fresh_empty_nights: nights still exactly as
--    the tap made them, with nothing pointing at them (any age).
--    twin_nights_removable: the ones to delete.
create or replace temporary view twin_fresh_empty_nights as
select n.id, n.host_id, n.venue_name, n.created_at,
       date_trunc('milliseconds', n.created_at) as created_ms
  from nights n
  join hosts h on h.id = n.host_id
 where n.venue_name = coalesce(h.default_venue, 'Soul Fire Pizza')
   and n.theme_key is null
   and n.scheduled_at is null
   and n.is_locked = false
   and n.room_magic_enabled = false
   and n.opened_at is null
   and n.closed_at is null
   and n.answer_engine = 'legacy'
   and n.answer_engine_latched_at is null
   and n.current_run_id is null
   and n.room_revision = 0
   and n.control_revision = 0
   and (select count(*) from games g where g.night_id = n.id) = 2
   and exists (select 1 from games g where g.night_id = n.id and g.game_no = 1)
   and exists (select 1 from games g where g.night_id = n.id and g.game_no = 2)
   and not exists (select 1 from games g where g.night_id = n.id
                    and (g.category_count = 6 and g.question_count = 7 and g.state = 'draft'
                         and g.started_at is null and g.ended_at is null) is not true)
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

create or replace temporary view twin_nights_removable as
select e.id, e.host_id
  from twin_fresh_empty_nights e
 where e.created_at < now() - interval '1 hour'
   and exists (
         select 1
           from nights m
          where m.host_id = e.host_id
            and m.id <> e.id
            and m.venue_name = e.venue_name
            and abs(extract(epoch from (date_trunc('milliseconds', m.created_at) - e.created_ms))) <= 5
            and (m.id not in (select f.id from twin_fresh_empty_nights f)
                 or date_trunc('milliseconds', m.created_at) > e.created_ms)
       );

-- 2. The list, taken once so the locks below know what to lock.
create temporary table twin_nights_to_delete on commit drop as
select id, host_id from twin_nights_removable;

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

-- 5. Delete, re-checking every rule: twin_nights_removable is read again
--    here, on a fresh snapshot taken after the locks above.
with deleted as (
  delete from nights n
   where n.id in (select id from twin_nights_to_delete)
     and n.id in (select id from twin_nights_removable)
  returning n.id
)
select count(*) as empty_twin_nights_deleted from deleted;

drop view twin_nights_removable;
drop view twin_fresh_empty_nights;

commit;

-- Dry run (read-only). The same rule as steps 1 and 2, as one SELECT, with
-- the settings shown so a person can read each night before anything goes.
-- DRY RUN START
-- with twin_fresh_empty_nights as (
--   select n.id, n.host_id, n.venue_name, n.created_at,
--          date_trunc('milliseconds', n.created_at) as created_ms
--     from nights n
--     join hosts h on h.id = n.host_id
--    where n.venue_name = coalesce(h.default_venue, 'Soul Fire Pizza')
--      and n.theme_key is null
--      and n.scheduled_at is null
--      and n.is_locked = false
--      and n.room_magic_enabled = false
--      and n.opened_at is null
--      and n.closed_at is null
--      and n.answer_engine = 'legacy'
--      and n.answer_engine_latched_at is null
--      and n.current_run_id is null
--      and n.room_revision = 0
--      and n.control_revision = 0
--      and (select count(*) from games g where g.night_id = n.id) = 2
--      and exists (select 1 from games g where g.night_id = n.id and g.game_no = 1)
--      and exists (select 1 from games g where g.night_id = n.id and g.game_no = 2)
--      and not exists (select 1 from games g where g.night_id = n.id
--                       and (g.category_count = 6 and g.question_count = 7 and g.state = 'draft'
--                            and g.started_at is null and g.ended_at is null) is not true)
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
--      and not exists (select 1 from diag_quota x where x.night_id = n.id)
-- ),
-- twin_nights_removable as (
--   select e.id, e.host_id
--     from twin_fresh_empty_nights e
--    where e.created_at < now() - interval '1 hour'
--      and exists (
--            select 1
--              from nights m
--             where m.host_id = e.host_id
--               and m.id <> e.id
--               and m.venue_name = e.venue_name
--               and abs(extract(epoch from (date_trunc('milliseconds', m.created_at) - e.created_ms))) <= 5
--               and (m.id not in (select f.id from twin_fresh_empty_nights f)
--                    or date_trunc('milliseconds', m.created_at) > e.created_ms)
--          )
-- )
-- select n.id, n.host_id, n.created_at, n.venue_name, h.default_venue, n.theme_key, n.scheduled_at, n.room_magic_enabled
--   from twin_nights_removable r
--   join nights n on n.id = r.id
--   join hosts h on h.id = n.host_id
--  order by n.created_at;
-- DRY RUN END

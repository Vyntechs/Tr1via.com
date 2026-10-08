# Diagnostic logs and the night timeline

A private flight recorder for live nights. It exists so a question like
"why did it lag at 7:06?" can be answered with one query instead of a guess.

It records. It never decides anything: the game does not read these tables, and
every write happens after the player, the TV or the host has already been
answered.

## Switch

| `DIAGNOSTIC_LOGGING` | Result |
| --- | --- |
| unset, `off`, anything else | Off (the default). The code runs exactly as before. Nothing is written, no phone or TV sends anything. |
| `on` | Server rows are written after each response; phones, TV and host laptop send small batched reports. |

The value is read when the app starts, so changing it on Vercel needs a
redeploy. That means it cannot be flipped in the middle of a show. Do not
deploy during a Wednesday show.

## What is recorded

| Table | One row per | Main columns |
| --- | --- | --- |
| `diag_answer_events` | answer tap the server received, saved or not | outcome (`saved`, `duplicate`, `late`, `early`, `rejected`, `error`), reason, the phone's tap and send times, server arrival time, milliseconds after the question opened, step timings, cold-start flag |
| `diag_server_actions` | host press (reveal, next, end early, undo, start, end, close, open, score adjust) and every timer-end resolve / finalize call | action, actor (`host` or `timer`), outcome, total / sign-in / database / broadcast milliseconds, broadcast result, cold-start flag |
| `diag_device_events` | small report from a phone, the TV or the host laptop | kind, device time, server-corrected time, small `data` payload |

Device report kinds: `device` (what the device is), `net` (online / offline /
connection type), `vis` (tab hidden / shown), `bcast` (a game change was
heard), `snap` (a room re-download), `res` (a slow or failed API call),
`ribbon` (the connection ribbon / "switch to a hotspot" screen turned on or
off), `chan` (realtime channel status), `reach` (server reachable or not),
`tap` / `tapx` (an answer tap as the phone saw it / one it ignored),
`lt` (main-thread stalls), `fps` (October scene frame rate).

Slow or failed events are always kept. Routine ones are kept for about half of
the player phones (decided once per page load) and for the TV and host laptop
always.

### Privacy

* The device id that is already stored on `players`, and for device events a
  short description of the phone (for example "iPhone, iOS 17.5, Safari").
* Display names are **not** copied into these tables. The timeline view joins
  them from `players`.
* No IP address, no answers text, no cookies, no raw error messages (the
  server maps every reason to a fixed word).
* Nothing is readable from a browser: row level security is on with no
  policies and the browser roles have no access. Only the service-role key
  (the server) can read or write.

## Reading times

Server times are exact. A device stamps events with its own clock, which can be
wrong. Every batch carries the device's send time, so the server stores
`at_est` = the event moved onto the server clock (good to about the upload
delay, so roughly a second on a bad connection). The timeline view sorts on
that corrected time. Always show it in Central time:

```sql
at time zone 'America/Chicago'
```

## Retention: 45 days

`cleanup_diagnostic_logs()` deletes rows older than 45 days from all three
tables and returns how many it removed. It refuses fewer than 7 days so a typo
cannot wipe a live night. **Nothing runs it automatically yet.** When logging
is turned on, schedule it once (needs `pg_cron` enabled in the Supabase
project):

```sql
select cron.schedule(
  'cleanup-diagnostic-logs',
  '17 9 * * *',
  $$select public.cleanup_diagnostic_logs(45)$$
);
```

Or run it by hand whenever you like:

```sql
select public.cleanup_diagnostic_logs(45);
```

## The night timeline

`diag_night_timeline` lines up, for one night, every diagnostic row plus the
game's own `reveals` and saved `answers`:

| Column | Meaning |
| --- | --- |
| `night_id` | the night |
| `at` | when it happened, on the server clock |
| `source` | `answer`, `action`, `device:player`, `device:tv`, `device:host`, `db_reveal`, `db_answer` |
| `who` | player display name, or `host` / `timer` / `database` / `tv a1b2c3` |
| `what` | short label, for example `late: deadline_passed` or `advance: ok` |
| `detail` | JSON with the numbers (milliseconds, ids, step timings) |

It is read-only and service-role only. Find a night's id from its room code:

```sql
select id, venue_name, opened_at from nights where room_code = 'K9PR4M';
```

From a terminal, `node scripts/night-timeline.mjs K9PR4M --from "2026-10-07 19:05" --to "2026-10-07 19:08"`
prints the same list (times are Central). It needs `DATABASE_URL`.

## The five most useful queries

Replace `:night_id` and `:question_id` with the real ids (ids are in the
timeline's `detail`).

### 1. Everything around one moment ("why did it lag at 7:06?")

```sql
-- Q1: all rows for a night inside a time window, in Central time.
select (at at time zone 'America/Chicago')::time(3) as local_time,
       source, who, what, detail
from diag_night_timeline
where night_id = ':night_id'
  and at between (timestamp '2026-10-07 19:05:30' at time zone 'America/Chicago')
             and (timestamp '2026-10-07 19:07:00' at time zone 'America/Chicago')
order by at;
```

### 2. Players with no saved answer for a question, and what their phones said

```sql
-- Q2: who had no saved answer, what the server saw from them, what the phone reported.
select p.display_name,
       (select count(*) from diag_answer_events a
         where a.night_id = p.night_id and a.question_id = ':question_id'
           and a.device_id = p.device_id) as taps_server_saw,
       (select string_agg(a.outcome || ': ' || a.reason, ', ' order by a.received_at)
          from diag_answer_events a
         where a.night_id = p.night_id and a.question_id = ':question_id'
           and a.device_id = p.device_id) as server_said,
       (select string_agg(d.kind || coalesce(' ' || (d.data ->> 'ev'), ''), '; ' order by d.at_est)
          from diag_device_events d
         where d.night_id = p.night_id and d.device_id = p.device_id
           and d.at_est between q.played_at - interval '5 seconds'
                            and q.played_at + interval '40 seconds') as phone_reported
from players p
join questions q on q.id = ':question_id'
where p.night_id = ':night_id'
  and p.removed_at is null
  and exists (select 1
                from game_participations gp
                join categories c on c.game_id = gp.game_id
               where gp.player_id = p.id and c.id = q.category_id)
  and not exists (select 1 from answers ans
                   where ans.question_id = ':question_id' and ans.player_id = p.id)
order by p.display_name;
```

No taps seen and nothing reported means the tap never left the phone or the
phone was offline. Taps seen as `late` or `early` means the server turned them
away (see query 5).

### 3. Host presses: where the time went, and how long each device took to hear it

```sql
-- Q3: each host press with its server timings, and the broadcast as each device heard it.
select (s.received_at at time zone 'America/Chicago')::time(3) as pressed,
       s.action, s.outcome, s.total_ms, s.auth_ms, s.db_done_ms,
       s.broadcast_done_ms, s.broadcast_ok, s.broadcast_error, s.cold_start,
       d.surface,
       coalesce(p.display_name, d.surface || ' ' || left(d.session_id, 6)) as device,
       round(extract(epoch from (d.at_est
             - (s.received_at + make_interval(secs => s.broadcast_done_ms / 1000.0)))) * 1000)
         as heard_ms_after_sent
from diag_server_actions s
left join diag_device_events d
  on d.night_id = s.night_id and d.kind = 'bcast'
 and d.at_est between s.received_at and s.received_at + interval '10 seconds'
 and d.data ->> 'ev' = case s.action
       when 'reveal' then 'reveal' when 'advance' then 'advance'
       when 'end_early' then 'end-early' when 'undo' then 'undo' else '-' end
left join players p on p.night_id = d.night_id and p.device_id = d.device_id
where s.night_id = ':night_id' and s.actor = 'host'
order by s.received_at, heard_ms_after_sent desc nulls last;
```

A big `auth_ms` or `db_done_ms` is the server being slow; a failed or slow
broadcast is `broadcast_ok` / `broadcast_done_ms`; a big `heard_ms_after_sent`
for only some devices is those devices' connection (compare with their `snap`
and `ribbon` rows in query 1).

### 4. Who saw the "switch to a hotspot" (or reconnecting) screen, and why

```sql
-- Q4: ribbon changes with the reasons the phone recorded at that moment.
select (d.at_est at time zone 'America/Chicago')::time(3) as local_time,
       coalesce(p.display_name, d.surface || ' ' || left(d.session_id, 6)) as device,
       d.data ->> 'from' as was,
       d.data ->> 'to'   as now,
       d.data ->> 'chan' as realtime_channel,
       d.data ->> 'reach' as server_reachable,
       d.data ->> 'bk'   as backup_mode,
       d.data ->> 'ol'   as browser_online
from diag_device_events d
left join players p on p.night_id = d.night_id and p.device_id = d.device_id
where d.night_id = ':night_id' and d.kind = 'ribbon'
order by d.at_est;
```

`now = unreachable` is the hotspot screen. Look at the same device's `snap`
rows just before it (query 1, or filter `kind = 'snap'`): `ok = false` with
`n = 3` means three room downloads failed in a row.

### 5. Every tap for one question, saved or turned away

```sql
-- Q5: all taps for a question, in server arrival order.
select (a.received_at at time zone 'America/Chicago')::time(3) as arrived,
       coalesce(p.display_name, 'device ' || left(a.device_id::text, 8)) as player,
       a.outcome, a.reason, a.http_status,
       a.ms_after_open,
       a.client_attempt,
       round(extract(epoch from (a.client_sent_at - a.client_tap_at)) * 1000) as phone_held_tap_ms,
       a.total_ms as server_ms,
       a.cold_start
from diag_answer_events a
left join players p on p.night_id = a.night_id and p.device_id = a.device_id
where a.night_id = ':night_id' and a.question_id = ':question_id'
order by a.received_at;
```

`ms_after_open` above 25000 is a tap that reached the server after the
25-second line (`late`). `phone_held_tap_ms` is how long the phone sat on the
tap before sending (retries); it uses only the phone's own clock, so it is
trustworthy even when the phone's clock is wrong.

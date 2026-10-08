# Diagnostic logs and the night timeline

A private flight recorder for live nights. It exists so a question like
"why did it lag at 7:06?" can be answered with one query instead of a guess.

It records. It never decides anything: the game does not read these tables, and
every write happens after the player, the TV or the host has already been
answered.

## Switch

| `DIAGNOSTIC_LOGGING` | Result |
| --- | --- |
| unset, `off`, anything else | Off (the default). The code runs exactly as before. Nothing is written, no phone or TV sends anything, and the daily cleanup call does nothing. |
| `on` | Server rows are written after each response; phones, TV and host laptop send small batched reports between questions. |

The server checks the value on every request, not once at start-up. But Vercel
gives each deployment the settings it was built with, so changing the value in
Vercel only takes effect on a **new deployment** (a redeploy). That means it
cannot be flipped in the middle of a show. Do not deploy during a Wednesday
show.

**Set it for the Production environment only.** Leave Preview and Development
unset, so preview copies of a branch and local runs never write rows (depending
on how the Vercel variables are set, a preview copy can talk to the same
database as production). Turning it on needs Brandon's typed yes.

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

When a device reports: **never while a question is live on that screen.**
Reports are held in the device's memory (at most 200 events; when full the
oldest routine one goes first and slow or failed ones are kept longest) and sent
a few seconds after the question closes (on the reveal), in the lobby or on the
board. A phone that has already locked in still counts as inside the question
until it closes. The one exception is the page being hidden or closed (a phone
locking its screen, a tab closing), when the held events are handed to the
browser's send-on-exit so they are not lost.

### The device summary (exactly what is stored about a device)

The first report of a page load (`device`) and every `net` report contain only
these keys, and the server rebuilds them from this fixed list, so nothing else
a device sends is kept:

| Key | Meaning | Where it comes from |
| --- | --- | --- |
| `br` | browser family + major version, e.g. `Safari 17` (plus `(Facebook app)` / `(in-app)` when the page is inside another app) | the request, read once on the server |
| `os` | operating system family only: `iOS`, `iPadOS`, `Android`, `macOS`, `Windows`, `ChromeOS`, `Linux`, `other` | the request |
| `dc` | device class: `phone`, `tablet`, `laptop`, `tv` (the TV screen is always `tv`), `unknown` | the request and which screen it is |
| `sc` | coarse screen class from the window width: `s` (under 480 px), `m` (480-899), `l` (900-1439), `xl` (1440 and up) | the device |
| `ol` | the browser says it is online | the device |
| `rm` | "reduce motion" is on (the October scene draws less, so frame rates are not comparable) | the device |
| `theme` | the night's theme key (which scene was drawing) | the device |
| `et` | connection type as the browser rounds it: `slow-2g`, `2g`, `3g`, `4g` | the device |
| `ty` | connection medium when the browser says so (`wifi`, `cellular`, ...) | the device |
| `rtt`, `dl` | the browser's own rounded round-trip (ms) and download (Mbit/s) estimates | the device |

`rtt` and `dl` are kept on purpose: they are the browser's rough read on how
good the connection is, which is the first thing to check when one phone lags.
The browser rounds them, so they cannot tell phones apart. `net` reports carry
`ev` (`online`, `offline`, `conn`), `ol`, and the four connection keys.

**Not stored:** the raw browser text (user-agent), the phone model, the OS
version, the exact screen size or pixel density, memory, CPU-core count, or
whether the page was added to the home screen. Lag is measured directly by the
`lt` (long task) and `fps` reports instead.

### Privacy

* The device id that is already stored on `players` (phones and the host), and
  for device events the short device summary above.
* Display names are **not** copied into these tables. The timeline function
  joins them from `players`.
* No IP address (it is used in memory for rate limiting and never stored), no
  answer text, no cookies, no raw error messages (the server maps every reason
  to a fixed word).
* Who a device report is about is decided on the server. A phone needs its
  device cookie and a player row in that night. The host laptop needs a
  signed-in host who owns the night. The TV has no login, so it can only name a
  real, existing room code: a night id sent by a TV is ignored, the night is
  looked up from the code, and a made-up code stores nothing.
* Nothing is readable from a browser: row level security is on with no
  policies and the browser roles have no access to the tables or the two
  functions. Only the service-role key (the server) can read or write.

### When logging itself has trouble

Log writes never change a response. If one fails, times out (2 seconds) or is
dropped (more than 50 writes at once on one server), the server prints one
short line to its console, at most one per kind a minute:

```
[diag] insert failed table=diag_answer_events code=42P01
[diag] dropping log writes: too many in flight
```

(`code` is the database's error code, or `timeout`; never the message, which
could contain row contents.) The count of dropped and failed writes is saved as
one row in `diag_server_actions` (`actor = 'system'`, `action = 'diag_drops'`,
`reason = 'dropped=N failed=M'`) as soon as the database takes a write again, so
a gap in a night's evidence says so:

```sql
select received_at, reason from diag_server_actions where action = 'diag_drops' order by received_at desc;
```

A test or a reader checking that logging works can look for any `[diag] insert
failed` line in the Vercel logs.

## Reading times

Server times are exact. A device stamps events with its own clock, which can be
wrong. Every batch carries the device's send time, so the server stores
`at_est` = the event moved onto the server clock (good to about the upload
delay, so roughly a second on a bad connection). The timeline sorts on that
corrected time. Always show it in Central time:

```sql
at time zone 'America/Chicago'
```

## Retention: 45 days

`cleanup_diagnostic_logs()` deletes rows older than 45 days from all three
tables and returns how many it removed. It refuses fewer than 7 days so a typo
cannot wipe a live night.

It runs by itself once a day (09:17 UTC, which is 4:17 am Central in summer and
3:17 am in winter) from a Vercel cron entry in `vercel.json`, which calls
`GET /api/cron/diag-cleanup`. Vercel's delivery is best effort (a run can be
missed or doubled); that is fine here, because the cleanup is the same
"delete what is older than 45 days" every time:

* **With `DIAGNOSTIC_LOGGING` off (or unset) the route answers 204 and does
  nothing**: it does not read the secret, touch the database or run the
  function. So merging this with logging off schedules a daily call that exits
  at once.
* With logging on it needs the header `Authorization: Bearer <CRON_SECRET>`,
  which Vercel sends by itself once a `CRON_SECRET` environment variable (a
  random string of at least 16 characters) is set for Production. With no secret set it refuses
  (401) and cleans nothing. It never takes a day count from the request.
* Vercel calls the project's Production deployment URL, so preview copies of a
  branch never run it.

One gap to know about: **turning logging off also stops the cleanup**, so rows
already in the tables stay until someone runs it by hand once:

```sql
select public.cleanup_diagnostic_logs(45);
```

(or removes everything for good with `truncate diag_answer_events,
diag_server_actions, diag_device_events;`).

## The night timeline

`diag_night_timeline(night_id, from, to)` is a read-only function (not a view,
so it can never get in the way of a later change to the `players`, `answers`
or `reveals` tables). For one night it lines up every diagnostic row plus the
game's own `reveals` and saved `answers`, ordered by time. `from` and `to` are
optional.

| Column | Meaning |
| --- | --- |
| `night_id` | the night |
| `at` | when it happened, on the server clock |
| `source` | `answer`, `action`, `device:player`, `device:tv`, `device:host`, `db_reveal`, `db_answer` |
| `who` | player display name, or `host` / `timer` / `database` / `tv a1b2c3` |
| `what` | short label, for example `late: deadline_passed` or `advance: ok` |
| `detail` | JSON with the numbers (milliseconds, ids, step timings) |

```sql
select * from public.diag_night_timeline('<night id>');
select * from public.diag_night_timeline('<night id>', '2026-10-08 00:05:30+00', '2026-10-08 00:07:00+00');
```

It is read-only and service-role only (the browser roles cannot run it).

> **Do not run timeline queries (or any of the queries below) during a show.**
> They read the live game tables as well as the diagnostic ones. Run them
> before the show or after it is over.

Find a night's id from its room code:

```sql
select id, venue_name, opened_at from nights where room_code = 'K9PR4M';
```

From a terminal, `node scripts/night-timeline.mjs K9PR4M --from "2026-10-07 19:05" --to "2026-10-07 19:08"`
prints the same list (times are Central). It needs `DATABASE_URL`.

## The five most useful queries

Replace `:night_id` and `:question_id` with the real ids (ids are in the
timeline's `detail`). Not during a show.

### 1. Everything around one moment ("why did it lag at 7:06?")

```sql
-- Q1: all rows for a night inside a time window, in Central time.
select (at at time zone 'America/Chicago')::time(3) as local_time,
       source, who, what, detail
from public.diag_night_timeline(
       ':night_id',
       timestamp '2026-10-07 19:05:30' at time zone 'America/Chicago',
       timestamp '2026-10-07 19:07:00' at time zone 'America/Chicago')
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

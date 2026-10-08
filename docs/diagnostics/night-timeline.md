# Diagnostic logs and the night timeline

A private flight recorder for live nights. It exists so a question like
"why did it lag at 7:06?" can be answered with one query instead of a guess.

It records. It never decides anything: the game does not read these tables, and
every write happens after the player, the TV or the host has already been
answered.

## Switch

| `DIAGNOSTIC_LOGGING` | Result |
| --- | --- |
| unset, `off`, anything else | Off (the default). The code runs exactly as before. Nothing is written and no phone or TV sends anything. (The daily cleanup is separate: it runs whenever `CRON_SECRET` is set.) |
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
| `diag_answer_events` | answer tap the server received, saved or not | outcome (`saved`, `duplicate`, `late`, `early`, `rejected`, `error`), reason, the phone's tap and send times, server arrival time (for the older answer engine, the exact instant the 25-second rule used; see "Reading times"), milliseconds after the question opened, step timings, cold-start flag |
| `diag_server_actions` | host press (reveal, next, end early, undo, start, end, close, open, score adjust) and every timer-end resolve / finalize call | action, actor (`host` or `timer`), outcome, total / sign-in / database / broadcast milliseconds, broadcast result, cold-start flag |
| `diag_device_events` | small report from a phone, the TV or the host laptop | kind, device time, server-corrected time, small `data` payload |
| `diag_quota` | night and kind of source inside it (`_night`, `phones`, `tv`, `host`, `taps`, `press`) | rows used so far and rows turned away at a cap (see "Who gets a row") |

Device report kinds: `device` (what the device is), `net` (online / offline /
connection type), `vis` (tab hidden / shown), `bcast` (a game change was
heard), `snap` (a room re-download), `res` (a slow or failed API call),
`ribbon` (the connection ribbon / "switch to a hotspot" screen turned on or
off), `chan` (realtime channel status), `reach` (server reachable or not),
`tap` / `tapx` (an answer tap as the phone saw it / one it ignored),
`lt` (main-thread stalls), `tz` / `paint` (the host laptop or the TV has
**painted** the timer reading 0 / the answer reveal, see "Did the screen really
draw it?" below), `fps` (October scene frame rate).

Slow or failed events are always kept. Routine ones are kept for about half of
the player phones (decided once per page load) and for the TV and host laptop
always.

When a device reports: **never while a question is live on that screen, and
never before the room has finished its first download** (until then nobody
knows whether a question is live). Reports are held in the device's memory (at
most 200 events; when full the oldest routine one goes first and slow or failed
ones are kept longest, also when a failed send is put back) and sent a few
seconds after the question closes (on the reveal), in the lobby or on the board.
A phone that has already locked in still counts as inside the question until it
closes. There is no exception for a hidden page: a phone that locks its screen
mid-question keeps what it holds in memory and sends it once it is awake and the
question has closed. A page that is hidden or closed BETWEEN questions hands
what it holds to the browser's send-on-exit so it is not lost; a tab closed in
the middle of a question loses what it held, on purpose. The venue TV also
needs the signed pass its page was given (below) and sends nothing without it.
One bounded exception: a screen whose room STILL has not loaded after 45
seconds is stuck on its loading screen (no question can be on it), and what
went wrong is the evidence worth having, so it may send up to 3 small reports
(60 events at most each) while it stays unloaded.

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
| `rel` | which deployment this page was built by: Vercel's deployment id, the **same value the server writes in the `deployment` column of its own rows** (blank on a local build) | the build |
| `sha` | the first 12 characters of the git commit of that build (blank on a local build) | the build |
| `et` | connection type as the browser rounds it: `slow-2g`, `2g`, `3g`, `4g` | the device |
| `ty` | connection medium when the browser says so (`wifi`, `cellular`, ...) | the device |
| `rtt`, `dl` | the browser's own rounded round-trip (ms) and download (Mbit/s) estimates | the device |

`rtt` and `dl` are kept on purpose: they are the browser's rough read on how
good the connection is, which is the first thing to check when one phone lags.
The browser rounds them, so they cannot tell phones apart. `net` reports carry
`ev` (`online`, `offline`, `conn`), `ol`, and the four connection keys.

Vercel makes `VERCEL_DEPLOYMENT_ID` (like `dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3`) and
`VERCEL_GIT_COMMIT_SHA` available at build time as well as at run time (Vercel's
"System environment variables" page), but only while the project setting **Enable
access to System Environment Variables** is on; if it is off, pages carry no `rel`
or `sha` and the server rows carry no `deployment` either.

`rel` and `sha` are public build labels (anyone who loads the site gets the same
ones), not anything about the person. A phone left open across a deploy keeps its
old `rel`, so the question "was this phone on an older version than the server?"
is one comparison:

```sql
-- Q6: devices of a night whose page was built by a different deployment than the one that served the taps.
select d.surface, left(d.session_id, 6) as page, d.data ->> 'rel' as page_built_by,
       d.data ->> 'sha' as page_commit, d.at_est
from diag_device_events d
where d.night_id = ':night_id' and d.kind = 'device'
  and d.data ->> 'rel' is distinct from
      (select a.deployment from diag_answer_events a
        where a.night_id = d.night_id and a.deployment is not null
        order by a.received_at desc limit 1)
order by d.at_est;
```

A device with no `rel` was a local build, or an older page from before this
label existed (a reason to look at that device first).

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
* Who a row is about is decided on the server, and only a verified source gets
  a row (see "Who gets a row").
* Nothing is readable from a browser: row level security is on with no
  policies and the browser roles have no access to the tables or to the
  functions (`diag_insert_rows`, `diag_take_rows`, the cleanup and the timeline). Only the service-role key (the server) can read or write.

### Who gets a row

The answer, host-press and timer-end routes and the report route can be called
by anyone, so a row is stored only for a caller the server has verified.
Everything else stores **nothing**; it is only counted, and one summary line a
minute is printed (`[diag] stored nothing for requests with no verified player
or host: answer=3 report=12`).

| Source | Stored when |
| --- | --- |
| Answer tap | the signed device cookie is valid AND that device is a player of the night the tap is about. Late, early, duplicate and turned-down taps from real players are stored (that is the point); a tap with no cookie, or from a device that never joined that night, is not. |
| Host press (reveal, next, ...) | the request is from a signed-in host who owns the night |
| Timer-end call (resolve / finalize) | the signed device cookie is a player of that night. The venue TV sends these without any login, so its calls are not stored (the TV's own `res` reports show them). |
| Phone report | valid device cookie + a player row in the night its room code names |
| Host laptop / phone report | a signed-in host who owns the night. This is checked after the 204 reply, so the host screen never waits on the sign-in service, and **strictly read-only**: the check reads the access token from the sign-in cookie as it is and asks the sign-in service who owns that exact token; it never renews a session and never writes a cookie (a renewal from here could use up the host's refresh token while the new one cannot reach her browser, and her browser's own renewal could then be refused, signing her out mid-show). A token that has already run out is dropped without any network call; the report is just counted. A session that passed in the last 5 minutes is remembered (by a hash of its cookies, in memory), so reports do not add a sign-in call each. A session the sign-in service turned down is remembered for 30 seconds too (a definite "no"), and a "could not check" (the sign-in service is slow or down) for 5 seconds, so one cookie sent again and again cannot make a sign-in call per log job while the service struggles (a real host's reports in those 5 seconds are not stored). Every report from a session that is not yet known good is charged first to its network address (a burst of 12, then one a second), and how many NEW sessions may start a check is limited per network address (6, then one every 10 seconds) and per server copy, all before anything is queued: a flood of forged cookies, a different one each time or the same one over and over, costs few log turns and, past the first few, no sign-in call (those reports get a 429 and a real host screen simply tries again later). Measured with the same forged cookie sent 120 times while the sign-in service answers "cannot tell": 12 log jobs and 1 sign-in call (before this change: 120 jobs and 24 calls). |
| TV report | the signed pass the server gave the TV page when it loaded. The pass names one night and lasts 8 hours; the night is read from the pass, never from the report. No pass, a forged or expired pass: nothing stored. The pass is signed with a key of its own (derived from `SESSION_SECRET` under a fixed label), so its signature is never valid as a device cookie, and a device-cookie signature is never valid as a pass. |

The pass is made while the TV page renders, which is outside every log job, so it
has limits of its own: a code that is not in the room-code format costs nothing;
a code the log already knows (found for ten minutes, not found for 30 seconds)
is answered from memory; only a never-seen code reaches the database, at most 10
in a burst and about 10 a minute after that, at most 3 at once, and none while
logging is paused. So 400 loads of made-up TV codes add about ten reads, not 400
(a real venue loads its TV page a handful of times a night). A load the limits
turn away simply gets no pass: that TV is not logged until it is reloaded.

The TV page is public by design (anyone with the room code can open it), so the
pass is not a login. It means a report cannot be invented for a night without
first loading that night's TV page, passes die on their own, and every report
is rebuilt from a fixed list of kinds and fields (a screen may only send the
kinds it really produces: taps only from phones, frame rates only from the TV
and host laptop; numbers are clamped, text must be one of a few fixed words, and
the little free text left, such as an error name, only allows letters, digits
and `_ - . : /` and is cut at 40 characters).

**Row caps** (`diag_quota`, `diag_take_rows`), so they hold across every server
instance. Rows past a cap are dropped and counted (in `diag_quota.rows_refused`,
and in the `diag_drops` row below as `capped=N`).

| Counter (`bucket`) | Cap | What it holds |
| --- | --- | --- |
| `_night` (reports) | 40,000 | everything the devices report, all kinds together |
| `_night` (taps and timer-end calls) | 60,000 | the same counter, with 20,000 of extra room that only the server's own tap and timer-end rows may use |
| `_night` (host presses) | 62,000 | the same counter again, with a **reserve of 2,000** above the 60,000 that nothing but a host press may use, so a press always gets its whole allowance, however full the night is |
| `phones` | 30,000 | every player phone's reports together |
| `tv` | 8,000 | the venue TV(s) of the night, reports |
| `host` | 8,000 | the host laptop and phone, reports |
| `taps` | 20,000 | every player phone's taps and timer-end calls together (server rows) |
| `press` | 2,000 | the host's button presses (server rows) |

On top of that, **one phone's share is counted in each server's memory** (not in
the database): 2,500 report rows and 1,500 tap / timer-call rows per phone per
server per night. It is in memory on purpose: a database row per phone would be
one extra database call per phone the first time each is seen (60 at once at
the first timer-end), all queuing on the night's counter. The cost is that a
verified phone that floods can get that much per server copy, not in total (a
dozen copies could fill the phones' 30,000-row share with one phone's reports); the kind
and night caps still hold for everyone.

Chatty device reports stop at 40,000 for the night; the server's own rows (taps,
timer-end calls, presses) are the evidence this is for, so they keep room above
that, and a night full of reports never blocks a late tap. Host presses have a
small reserve of their own on top of that (62,000 against the others' 60,000),
so even a night where the reports and the taps have both hit their ceilings
(taps at four times the expected volume) still stores every press: the press
allowance is 2,000 rows and all of them are always available. (The price is that
in that extreme the others share 58,000 to 60,000, depending on how many presses
came first.) A busy 40-phone night is roughly 20,000 to 35,000 rows in all; the
worst case is 62,000 small rows, about 26 MB. To keep it cheap, a server asks for rows in blocks (100 at a time
for phones' reports and taps, 25 for the rest), and the jobs that find a block
spent at the same moment share ONE call; a full kind is not asked about again
for a minute (so the caps can overshoot by up to one block per server). **The
check never waits for a lock**: the database function takes a per-night try-lock
(in the two-integer advisory-lock key space, which the game's own locks never
use, so it can never be a lock an answer is waiting on) and answers "busy" at
once if another server is updating that night's counter at that instant (and
gives up on any row lock after 50 ms); the server then backs off without
holding a connection, asks again (up to 5 more times while the copy's retry
budget lasts, see "Busy is not trouble" below), and drops the rows if it is still busy. The function touches only `diag_quota`, never a game
table. Per-instance rate limits (per address, per device, per TV night) stay as a
first filter only. One consequence to know about: everything at a venue shares one
network address, so a guest on the venue's wifi who floods the report route from
that address can use up its allowance (a burst of 120, then 10 a second) and the real
host laptop's NEW sessions are turned away (429) until it refills; the host's own
log can be blind for that time. This costs only log rows, never play, and the
night's other evidence (the server's own rows for taps and presses) is unaffected.

```sql
-- how close was each night to its caps?
select night_id, bucket, rows_taken, rows_refused from diag_quota
where rows_refused > 0 or bucket = '_night' order by rows_taken desc limit 20;
```

### When logging itself has trouble

Log writes never change a response, and they must never compete with real
answers for the database. Three limits stack, each one a different failure:

1. **At most 5 log jobs per server copy** touch the database at once; the rest
   wait in a short queue (200 jobs). A job that waits more than 8 seconds for its
   turn, or arrives to a full queue, is dropped and counted.
2. **At most 3 log writes at once across ALL server copies, enforced by the
   database.** The per-copy limit alone is not enough: ten copies are fifty, and
   PostgREST has only about ten connections for everything. So the function
   `diag_insert_rows` first tries, without ever waiting, to take one of 3 "write
   slots" (transaction-scoped advisory locks in a key class nothing else uses). If
   all 3 are taken it answers `-1` ("busy") at once, having written nothing and
   holding no connection; the app waits a moment and asks again (up to 5 more
   times, see "Busy is not trouble" below), then drops the rows and counts them
   (`slots`). So when the log tables stall,
   at most 3 statements can be waiting at the database, whatever the number of
   copies, and everything else is turned away in about a millisecond instead of
   queuing for a connection a tap or a question-close call needs. A healthy
   insert holds a slot for a few milliseconds.
3. **A slow write is cancelled by the database itself, quickly.** Hanging up the
   HTTP request does not stop the statement behind it (PostgREST keeps running it
   after the app has gone, and runs a request that was still waiting for a
   connection later), so the app does not rely on that. `diag_insert_rows` and the
   row-cap check `diag_take_rows` carry a **statement timeout of 0.5 seconds**,
   and `diag_insert_rows` a **lock timeout of 0.1 seconds** (a healthy insert
   takes a few milliseconds), as settings on the functions themselves.
   PostgREST applies a function's own `statement_timeout` to the call of that
   function only, so no other query (nothing the game runs) gets a shorter limit,
   and nothing is set on a role or on the database. A write that runs past it is
   cancelled and rolled back with error `57014` (or `55P03` for a table lock that
   would not give way). (This relies on PostgREST applying function-level
   `statement_timeout`, which it does by default and which was checked on a local
   PostgREST only; if a PostgREST ever stopped doing that, a stalled write would
   last as long as the stall, and limits 1 and 2 would still hold.)

**The turn is not given back until the database is done.** A job keeps its turn
until every database call it made has *returned*: a normal answer, the database's
own "cancelled" error, or, only if nothing answers for 12 seconds, the app
cancels the request and holds the turn 1 second longer. No call starts after the
job's 5 second clock, and one job makes one call at a time (reading the drop
counts back out to the database is a call too, and happens inside the turn). So
the app never counts a statement as finished when it is still running.

**Busy is not trouble, but it is rationed.** When many server copies log in the same
instant (the timer-end burst: 25 to 60 phones asking to close the question at clock
zero), the 3 write slots and the night's row-cap counter are each taken for a few
milliseconds at a time, on a perfectly healthy database. A "busy" answer therefore
never counts toward the pause, however often it repeats. Instead a job that hears
"busy" waits and asks again: the wait starts at 20 ms, doubles each time up to 160 ms,
and each wait is a random 50 to 100% of that so the copies do not collide again
together, at most 5 more tries and about 0.45 seconds in all, holding no connection
while it waits. This all happens after the response has gone out; the only cost is
that the job keeps its turn (one of the 5 per copy) a little longer.

A "busy" answer is cheap for the database but not free: it is still a request through
the same gateway and the same few connections the game's own reads use. The first
version of this follow-up let every job retry 5 times and never paused. Under a
flood that kept almost every one of the copy's 5 log turns waiting on a request at
the gateway at all times (measured: on average about 160 requests in flight from 40
copies, against 14 to 90 on #210), and a plain game read through the API queued
behind them. So retries are rationed across the whole server copy: one shared budget
of 40 retries that refills at 5 a second (row-cap checks and inserts draw on the same
budget). A timer-end burst fits inside it; a sustained flood runs it dry, and from
then on this copy is "braked" for 1.5 seconds: it makes at most ONE insert try every
quarter second (a little random either way) and every other job gives its rows up at
once, without calling the database (counted as `slots`). A try that finds a free slot stores its
rows and ends the brake; a try that finds the slots still taken keeps the brake on.
The host's button presses, which are rare, ignore both the budget and the brake. The
brake is a limit on calls, not a pause: it is not a failure. The stalled writes that
really hold slots in a stall answer with `57014` / `55P03` to the copies that made
them, and those copies pause as below. When the game's database is under real
pressure the choice is deliberate: **game speed wins over keeping every log row**.

*Measured* (local Supabase on one Mac, shared with other jobs, one in-process "copy"
per server copy, a plain game-table read through the API from a separate process,
#210 / the first version of this follow-up / this version interleaved, medians over
5 or 6 runs each; hosted Supabase and Vercel were not measured):

| Scenario | Rows stored (of offered) | Game read, median of the runs' p50 |
| --- | --- | --- |
| Healthy burst, 12 copies x 5 jobs (60 rows) | #210 172 of 180 / first version 180 / now 180 | 0.9 ms on all three |
| Healthy burst, 20 copies x 3 jobs (60 rows) | #210 174 / first version 180 / now 180 | 0.9 ms on all three |
| Healthy flood, 12 copies x 25 jobs/s, 15 s | 4,499 / 4,500 / 4,500 of 4,500 | 0.8 ms on all three |
| Healthy flood, 20 copies x 30 jobs/s, 15 s | 8,971 / 9,000 / 8,982 of 9,000 | 0.8 ms on all three |
| 12 x 25 jobs/s with the machine's CPU saturated (14 busy loops) | 1,319 / 2,740 / 1,535 of 4,500 | 2.0 / 2.1 / 2.0 ms (p90 2.8 / 3.5 / 2.95); database calls 2,597 / 11,188 / 3,600 |
| Overload, 40 copies x 40 jobs/s, 12 s (8 interleaved runs) | 2,320 / 3,274 / 2,448 of 19,200 | 2.7 / 70 / 2.4 ms (first version slower in all 8 runs; now in line with #210 in 7 of 8) |

Read it honestly: when the database is healthy none of this matters and all three
versions store essentially everything (the earlier "4,500 of 4,500 stored" holds only
in that case; on a stack that was already struggling a reviewer got 1,572 to 2,515 of
4,500 for the first version). When it is overloaded, the first version stored more
rows than #210 but its permanent queue of retries made game reads about 25 times
slower (70 ms against 2.7 ms), and this version stores about what #210 stored (less
than the first version) and keeps game reads at #210's speed. In one of the eight
overload runs this version's game read was slow (67 ms; the first version's was 15 ms
in the same pair, and both stored only about 300 rows, while #210 ran just before at
3.7 ms): the whole local stack stalled and I did not find why. The CPU-saturated row
shows the same call counts (first version 4 times #210's) but no clear difference in
game-read speed, so the slowdown needs a deep queue, not just extra calls. Game speed wins over keeping every row.

**Logging pauses itself when the database is in trouble with log writes.** Even 3
stalled log statements at a time would keep connections busy for as long as taps
keep coming, and those are the connections the question-close calls at timer end
need. So after 2 log calls in a row come back in trouble, this server copy drops
new log jobs, without asking the database anything, for 10 seconds (counted as
`paused`). After that ONE job is let through to see whether the database is back;
a good answer ends the pause, another failure starts a new one. A log row lost
this way is the intended price; a slower tap or press is not.

*What counts as "in trouble":* the database cancelling a write (`57014`) or giving
up on a lock (`55P03`); no answer in 12 seconds; a full connection pool
(`PGRST003`); a gateway error; "fetch failed"; a missing table or function; a
refused connection; and an id lookup that takes more than 2 seconds. *What does
not:* the table refusing one particular row (a data or constraint error); a job
that ran out of its 5 seconds before it could send its write; and any number of
"busy" answers (the night's counter or the write slots were taken), which is
ordinary contention. Only a stored INSERT clears the streak of failures: a fast row-cap
answer ("yes, room for 100 more") does not.

The id lookups ("is this device a player of the night?") are reads of the game's
own tables, which cannot be given a log-only time limit; the job that started one
keeps its turn until it returns, even if the log gave up waiting for the answer
after 2 seconds (and counted the caller as "slow"). The TV page's pass lookup is
bounded separately (see "Who gets a row").

If a write fails, times out or is dropped, the server prints one short line to
its console, at most one per kind a minute:

```
[diag] insert failed table=diag_answer_events code=42P01
[diag] insert failed table=diag_answer_events code=57014
[diag] dropping log writes: too many waiting
[diag] dropping log writes: waited too long for a turn
[diag] row-cap check busy: dropping log rows instead of waiting
[diag] log write slots all taken: dropping log rows instead of waiting
[diag] pausing log writes: the database keeps cancelling them for being slow
[diag] stored nothing for requests with no verified player or host (slow = could not be checked in time): answer=3 report=12 slow=2
```

The last line is the once-a-minute summary of callers that got no row. `slow`
means a check (is this device a player of the night? does this host own it?)
could not be answered in time; those callers are NOT counted as strangers.

(`code` is the database's error code, or `timeout`; never the message, which
could contain row contents. `57014` is the database cancelling a write that ran
past its 0.5 seconds; `timeout` is the app cancelling a request nothing answered
for in 12 seconds.) The counts are saved as one row in `diag_server_actions`
(`actor = 'system'`, `action = 'diag_drops'`) as soon as the database takes a
write again, so a gap in a night's evidence says so, and says why. The numbers are
in `steps`; `reason` only names the kinds that are not zero (for example
`see steps: dropped,timed_out,paused`), so it always fits the column's 64
characters however large the counts have grown. (If the database ever refused the
row itself, the counts are discarded with one console line instead of being
retried every ten seconds.)

| Count (in `steps`) | The true reason |
| --- | --- |
| `dropped` | jobs that never got a turn: `queue_full` (too many waiting) plus `waited_too_long` (8 seconds without a turn), both in `steps` |
| `busy` | the row-cap counter of the night was held by another server at that instant, even after all the retries |
| `slots` | all 3 of the database's log write slots stayed taken, even after all the retries (including the single try a braked copy makes, see "Busy is not trouble") |
| `timed_out` | the database cancelled the write (`57014`, `55P03`) or nothing answered in 12 seconds |
| `paused` | dropped on purpose while logging was paused because the database was in trouble with log writes |
| `failed` | the database answered with some other error (a missing table, for example) |
| `capped` | rows past a row cap |

The console line that follows a successful save names the same reasons, for
example `[diag] dropped 3 log writes (jobs that never got a turn: 3 found the queue full, 0 waited too long)` or
`[diag] dropped 1 log row batches (the row-cap counter was busy)`.

```sql
select received_at, reason, steps from diag_server_actions where action = 'diag_drops' order by received_at desc;
```

A test or a reader checking that logging works can look for any `[diag] insert
failed` line in the Vercel logs.

**Never `truncate` or `lock` the log tables during a show.** Both take a lock that
every log write has to wait for (the writes give up after 0.1 seconds and the
copies pause, so play is not slowed, but the evidence for that stretch is lost).
Do it between shows.

## Switching it off, and taking it out

*Switch off:* set `DIAGNOSTIC_LOGGING` to `off` (or remove it) for Production and
redeploy (never during a show). From then on nothing is written, no phone or TV
sends anything, and no log code path runs. What is already stored stays until the
45-day cleanup removes it (the cleanup keeps running whenever `CRON_SECRET` is
set, flag on or off). To stop even the cleanup, remove `CRON_SECRET`.

*Take it out completely* (nothing else in the database depends on these objects,
so plain drops are enough, and applying the migration again later brings it back):

```sql
drop table if exists public.diag_answer_events, public.diag_server_actions,
  public.diag_device_events, public.diag_quota;
drop function if exists public.diag_insert_rows(text, jsonb);
drop function if exists public.diag_take_rows(uuid, text, integer, integer, integer);
drop function if exists public.cleanup_diagnostic_logs(integer, integer);
drop function if exists public.diag_night_timeline(uuid, timestamptz, timestamptz);
```

Then remove the `CRON_SECRET` setting (or the cleanup route answers 500 every day
because its function is gone).

## Did the screen really draw it? (`tz` and `paint`)

The host laptop and the venue TV draw the same question screen. When that screen
commits the frame that shows the timer at **0**, and again when it commits the
answer **reveal**, it waits two animation frames (the second one runs after the
browser has painted) and records `tz` (timer-zero drawn) or `paint` (reveal
drawn), once per kind and question, with the question id. A tab that is hidden
draws no frames, so nothing is claimed for a screen nobody could see; the missing
row is itself the answer. The event is held in memory like every other and sent
after the question closes, so it adds nothing during a question, and it costs
nothing at all while logging is off (no animation frame is even requested).

```sql
-- Q7: for each question, when the question opened (server), when its timer-zero and reveal were drawn on each host/TV screen.
select q.id as question_id,
       (q.played_at at time zone 'America/Chicago')::time(3) as opened,
       d.surface, left(d.session_id, 6) as screen, d.kind,
       (d.at_est at time zone 'America/Chicago')::time(3) as drawn,
       round(extract(epoch from (d.at_est - (q.played_at + interval '25 seconds'))) * 1000) as ms_after_the_25s_mark
from diag_device_events d
join questions q on q.id = (d.data ->> 'q')::uuid
where d.night_id = ':night_id' and d.kind in ('tz', 'paint')
order by q.played_at, d.at_est;
```

What `tz` means: "this screen painted the timer reading 0". It is sent the first
time a screen shows 0 for a question, so a TV or host laptop that is **loaded or
reloaded after the 25 seconds are already over** also sends one, as soon as it has
drawn its first frame: for that screen `tz` means "drawn when the page loaded", not
"drawn on time". Read it together with the screen's `device` row (its first report
of this page load, whose time is when the page started): a `tz` that arrives within
a second or two of a new `device` row from the same screen is a late mount, not a
late frame. Q7's `ms_after_the_25s_mark` also assumes the 25 second question length.

`at_est` is the device's clock moved onto the server's (good to about the upload
delay, so roughly a second on a bad connection; see below): use it to see a screen
that drew zero seconds late or never, not to argue about a few hundred
milliseconds.

## Reading times

Server times are exact. For an answer tap, `received_at` is the instant the
25-second rule compared against the line: the answer route notes its own
timestamp (taken the moment the route starts) and the row uses that, so a tap the
rule turned away at 25.000 s can never be logged as 24.999 s (the logging
wrapper stamps a hair earlier, and used to be what the row showed). This holds
for the older ("legacy") answer engine, where the route decides. On the newer
engine (`resilient_v1`) the database's own clock decides the deadline, so
`received_at` there is the wrapper's stamp and the closing time is in the
database's `question_plays` row. A device stamps events with its own clock, which can be
wrong. Every batch carries the device's send time, so the server stores
`at_est` = the event moved onto the server clock (good to about the upload
delay, so roughly a second on a bad connection). The timeline sorts on that
corrected time. Always show it in Central time:

```sql
at time zone 'America/Chicago'
```

## Retention: 45 days

`cleanup_diagnostic_logs(days, batch)` deletes rows older than 45 days from all
the diagnostic tables, at most 5,000 rows per table per call, and returns how
many it removed. It refuses fewer than 7 days so a typo cannot wipe a live
night. Each call is its own database transaction, so after a flood the cleanup
still makes progress (one giant delete would be rolled back if it ran too long
and never finish).

It runs by itself once a day (09:17 UTC, which is 4:17 am Central in summer and
3:17 am in winter) from a Vercel cron entry in `vercel.json`, which calls
`GET /api/cron/diag-cleanup`. Each run repeats the function until it removes
nothing, up to 20 calls or about 20 seconds (each call is capped at 10 seconds, and
the route may run for at most 30), then stops and says so
(`"more": true`); the next day's run carries on. Vercel's delivery is best
effort (a run can be missed or doubled); that is fine, because every run is the
same "delete what is older than 45 days".

* It runs **whenever `CRON_SECRET` is set, whether or not logging is on**
  (yes: with the flag off the daily cleanup still runs), so turning logging off
  never leaves old rows behind. On empty tables it removes nothing. While the
  migration has not been applied it answers 500 every day (harmless).
* It needs the header `Authorization: Bearer <CRON_SECRET>`, which Vercel sends
  by itself once a `CRON_SECRET` environment variable (a random string of at
  least 16 characters) is set for Production. With no secret set, or a wrong
  one, it refuses (401) and cleans nothing. A secret that is set but shorter than
  16 characters is refused loudly, whatever the caller sends: the route prints one
  line to the server log (`cleanup NOT running: CRON_SECRET is set but shorter than
  16 characters`) and answers 500 with that sentence (never the secret), so a day
  of failed cron runs in Vercel shows why. It never takes a day count from the request.
* Vercel calls the project's Production deployment URL, so preview copies of a
  branch never run it.
* If the migration has not been applied it answers 500 with the database's
  error code instead of 200. **Before switching logging on, confirm the first
  cron run (or a manual `GET` with the secret) answers 200.**

To clean up by hand, repeat this until it returns 0:

```sql
select public.cleanup_diagnostic_logs(45, 5000);
```

(or remove everything for good with `truncate diag_answer_events,
diag_server_actions, diag_device_events, diag_quota;`).

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
| `source` | `answer`, `action`, `device:player`, `device:tv`, `device:host`, `db_reveal`, `db_answer` (see the note below) |
| `who` | player display name, or `host` / `timer` / `database` / `tv a1b2c3` |
| `what` | short label, for example `late: deadline_passed` or `advance: ok` |
| `detail` | JSON with the numbers (milliseconds, ids, step timings) |

```sql
select * from public.diag_night_timeline('<night id>');
select * from public.diag_night_timeline('<night id>', '2026-10-08 00:05:30+00', '2026-10-08 00:07:00+00');
```

It is read-only and service-role only (the browser roles cannot run it).

**Known gap: `db_answer` lines cover the older ("legacy") answer engine only.**
Nights on the newer engine (`answer_engine = 'resilient_v1'`) keep their saved
answers in `question_play_answers`, which the timeline does not read (adding it
would make this migration depend on the newer engine's tables). Those answers
are still on the timeline as `answer` lines with `outcome = saved` (written by
the server as each tap arrives). To see the database's own rows for one question:

```sql
select a.locked_at at time zone 'America/Chicago' as locked_at, p.display_name, a.visible_slot, a.ms_to_lock
from question_play_answers a
join question_plays qp on qp.id = a.play_id
join players p on p.id = a.player_id
where qp.night_id = '<night id>' and qp.question_id = '<question id>'
order by a.locked_at;
```

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

`ms_after_open` of 25000 or more is a tap that reached the server at or after
the 25-second line (`late`). `phone_held_tap_ms` is how long the phone sat on the
tap before sending (retries); it uses only the phone's own clock, so it is
trustworthy even when the phone's clock is wrong.

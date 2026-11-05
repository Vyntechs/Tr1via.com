# Comparison data: live close prototypes

Paths start at the scratchpad root. R means harness/room/results and L means logs-proto. Every number comes from the file cited beside it or named above its table. Arithmetic done here is marked as such. Nothing was run for this file, and git was only read.

## Read this first

Two of the six planned arms have no data. C2 and Floor + trigger each started and then stopped, leaving one log of Node warnings and no summary.

- C2: R/c2 holds only runs/S1-seed1.log (605 bytes, 23:59). L/c2-matrix.log is 0 bytes.
- Floor + trigger: R/floor-trigger holds only runs/S2-seed1.log (609 bytes, 22:54). L/floor-trigger.log is 0 bytes.
- No matrix, stack or Next.js process was running at 00:03, so neither arm is still going.

Because Floor + trigger is missing, C1 has no partner in its own rig mode. C1 ran repo-head and every other arm ran prod-parity. No file records the mode Floor + trigger used, but prod-parity skips the trigger by file name (RUN.md:33), so it needed repo-head or a renamed copy. Its times can't be set against Floor or C3, and its results can't be split between the trigger and the closer. Who closed, stuck counts, row counts, deadlocks: these are outcomes, so they're shown side by side. Lost and unscored counts are shown too, but on C1 they mix in the database trigger (rig-pg/README.md:36).

The two floor-rejoin arms were never run. R/floor-rejoin-off and R/floor-rejoin-on don't exist, so the gap harness/room/PORTED.md:64 describes is missing. All three floor-code arms (Floor, C1, C3) ran with that read off. It could move the Not Locked in numbers in seven scenarios: S2, S4, S7, S7s, S8, S9, S10.

## Arms by mode

| Arm | Mode | Code | Policy, switches | Runs | Source |
| :- | :- | :- | :- | :- | :- |
| Today, S1 to S9 | prod-parity | b71ec25 | baseline | 22, 2 seeds | R/baseline/matrix.json |
| Today, S10 to S12 | prod-parity | b71ec25 | baseline | 6, 2 seeds | R/today-new/matrix.json |
| Today, S9 recheck | prod-parity | b71ec25 | baseline | 4 S9 runs | R/today-recheck, R/today-recheck-s9 |
| Floor | prod-parity | 5fefaa0 | floor | 28, 2 seeds | R/floor/matrix.json |
| Floor + trigger | missing | missing | missing | missing | R/floor-trigger |
| C1 | repo-head | b4f1086 | floor, LIVE_CLOSE_MODE=on | 28, 2 seeds | R/c1/matrix.json |
| C2 | missing | d8c3050 is the branch head; no run finished | missing | missing | R/c2 |
| C3 | prod-parity | 3812ea6 | floor, LIVE_CLOSE_MODE=on | 28, 2 seeds | R/c3/matrix.json |

proto-c2.md says the C2 arm needs repo-head, so a finished C2 run would be C1's only same-mode partner.

Harness health was clean on all five finished arms. Event loop lag p99 peaked at 13.3ms and max at 38.5ms. Stand-in refusals, unhandled gateway calls, hard stops and operator errors are all 0, and `failed` is empty in every matrix.json (L/comparison/extract.out). devices.mjs, run-one.mjs and the policy files were last changed at 22:08 to 22:11, before today-new and Floor ran, so Today S10 to S12 and all three floor-code arms used one harness. R/baseline is older (19:30). Per the port agent's report in this job's brief, selftest pins the baseline branch as unchanged. That one claim has no file behind it here.

Two seeds, and RUN.md:163 says seeds don't pin a run: compare spreads. Counts of 0 to 3 are treated as ties below.

## 1. Scenario tables

S5h and S7s are the two added scenarios, so there are 14 tables.

How to read the columns:

- Close: seconds after the 25s deadline per seed (s1, s2). Several values mean several questions. "(host press)" means closedByManualPress was true.
- Who: on Today this is only the broadcast event (resolve, end-early), because b71ec25 writes no close log line. On the floor-code arms it's the app's own log line (PORTED.md:80-85).
- Stuck: never closed, or closed only because the host pressed (RUN.md metrics).
- Not Locked in: phone seconds after answers.locked_at not showing Locked in, summed over phones and averaged per run, with the worst single phone in brackets.
- False late and Still checking say missing on R/baseline because those keys aren't in that older matrix.json. They only exist under floor wording, so the loss is a field, not a result.
- Rows: resolve rows and reveal rows in `reveals`, highest per question.
- Broadcasts: close broadcasts, then every broadcast carrying this question's id (run-one.mjs:346), highest per question.
- Peak: busiest second sent, then busiest second landed. Landed runs far above sent when held requests are released together (S8, S10).

Generated cells were checked against all 56 summary.txt lines. All of these matched: stuck, lost, saved, tapped, unscored, Not Locked in, didn't go through, resolve rows, close broadcasts, peak sent, deadlocks.

### S1: clean game, 3 questions

Sources: R/{baseline,floor,c1,c3}/matrix.json row S1, and R/ARM/runs/S1-seed1.json and S1-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.40..+0.46 resolve; s2 +0.40..+0.44 resolve | 0 | 0 (253/253) | 0 | 32.8 (0.3) | 0 / 0 / missing | missing | 0 (0) | 1 / 1 | 1 / 4 | 155 / 155 | 0 |
| Floor | prod-parity | s1 +0.20..+0.21 phone; s2 +0.21..+0.24 phone | 0 | 0 (253/253) | 0 | 32.2 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 4 | 159 / 159 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.21..+0.23 phone; s2 +0.24..+0.25 phone | 0 | 1 (252/253) | 0 | 32.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 4 | 158 / 158 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.20..+0.24 phone; s2 +0.22..+0.24 phone | 0 | 0 (253/253) | 0 | 32.8 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 4 | 155 / 155 | 0 |

### S2: incident at 50: replies lost 13s mid-question, host direct path blind 30s

Sources: R/{baseline,floor,c1,c3}/matrix.json row S2, and R/ARM/runs/S2-seed1.json and S2-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.42 resolve; s2 +0.38 resolve | 0 | 0 (85/85) | 0 | 245.7 (16.2) | 87.8 / 21.4 / missing | missing | 6.5 (1.4) | 1 / 1 | 1 / 3 | 90 / 83 | 0 |
| Floor | prod-parity | s1 +0.23 phone; s2 +0.22 phone | 0 | 0 (85/85) | 0 | 251.2 (17.1) | 0 / 0 / 0 | 117.4 | 0 (0) | 1 / 1 | 1 / 3 | 87 / 80 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.25 phone; s2 +0.22 phone | 0 | 0 (85/85) | 0 | 248.9 (18.1) | 0 / 0 / 0 | 112.6 | 0 (0) | 1 / 1 | 1 / 3 | 86 / 76 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.22 phone; s2 +0.23 phone | 0 | 1 (84/85) | 0 | 247.4 (17.9) | 0 / 0 / 0 | 113.2 | 0 (0) | 1 / 1 | 1 / 3 | 86 / 79 | 0 |

### S3: host offline 60s, TV up

Sources: R/{baseline,floor,c1,c3}/matrix.json row S3, and R/ARM/runs/S3-seed1.json and S3-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.40 None/resolve; s2 +0.43 None/resolve | 0 | 0 (85/85) | 0 | 11 (0.3) | 0 / 0 / missing | missing | 0 (0) | 1 / 1 | 1 / 3 | 146 / 146 | 0 |
| Floor | prod-parity | s1 +0.24 None/phone; s2 +0.20 None/phone | 0 | 1 (84/85) | 0 | 10.8 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 146 / 146 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.24 None/phone; s2 +0.25 None/phone | 0 | 0 (84/84) | 0 | 10.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 144 / 144 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.24 None/phone; s2 +0.23 None/phone | 0 | 0 (85/85) | 0 | 11.2 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 144 / 145 | 0 |

### S4: host and TV offline; phones lose replies for the last 6s

Sources: R/{baseline,floor,c1,c3}/matrix.json row S4, and R/ARM/runs/S4-seed1.json and S4-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.40 resolve; s2 +0.42 resolve | 0 | 1 (84/85) | 0 | 58.2 (14.3) | 7.2 / 11.6 / missing | missing | 0 (0) | 1 / 1 | 1 / 3 | 73 / 73 | 0 |
| Floor | prod-parity | s1 +0.23 phone; s2 +0.27 phone | 0 | 0 (85/85) | 0 | 62.5 (13.7) | 0 / 0 / 0 | 20.9 | 0 (0) | 1 / 1 | 1 / 3 | 69 / 69 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.20 phone; s2 +0.20 phone | 0 | 0 (85/85) | 0 | 68.3 (12.5) | 0 / 0 / 0 | 24 | 0 (0) | 1 / 1 | 1 / 3 | 68 / 68 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.23 phone; s2 +0.22 phone | 0 | 0 (85/85) | 0 | 68.2 (13.1) | 0 / 0 / 0 | 23.5 | 0 (0) | 1 / 1 | 1 / 3 | 67 / 68 | 0 |

### S5: 09-23 case: clocks 1.5s fast, reveal broadcast not heard

Sources: R/{baseline,floor,c1,c3}/matrix.json row S5, and R/ARM/runs/S5-seed1.json and S5-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +14.93 end-early (host press); s2 +15.74 end-early (host press) | 2 | 0 (83/83) | 0 | 10.7 (0.3) | 0 / 0 / missing | missing | 0 (0) | 1 / 1 | 1 / 2 | 97 / 97 | 0 |
| Floor | prod-parity | s1 +0.32 phone; s2 +0.31 phone | 0 | 0 (83/83) | 0 | 10.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 136 / 138 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.29 phone; s2 +0.30 phone | 0 | 0 (83/83) | 0 | 10.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 154 / 154 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.31 phone; s2 +0.30 phone | 0 | 0 (83/83) | 0 | 10.8 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 160 / 161 | 0 |

### S5h: control: clocks 1.5s fast, reveal broadcast heard

Sources: R/{baseline,floor,c1,c3}/matrix.json row S5h, and R/ARM/runs/S5h-seed1.json and S5h-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.42 resolve; s2 +0.45 resolve | 0 | 1 (84/85) | 0 | 11 (0.3) | 0 / 0 / missing | missing | 0 (0) | 1 / 1 | 1 / 3 | 162 / 159 | 0 |
| Floor | prod-parity | s1 +0.22 phone; s2 +0.24 phone | 0 | 0 (85/85) | 0 | 11.2 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 93 / 110 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.23 phone; s2 +0.24 phone | 0 | 0 (85/85) | 0 | 11.1 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 143 / 148 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.24 phone; s2 +0.22 phone | 0 | 0 (85/85) | 0 | 11.1 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 103 / 103 | 0 |

### S6: all 50 answer in one instant, second night heartbeating

Sources: R/{baseline,floor,c1,c3}/matrix.json row S6, and R/ARM/runs/S6-seed1.json and S6-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 -9.23 end-early; s2 -9.25 end-early | 0 | 0 (100/100) | 0 | 12 (0.3) | 0 / 0 / missing | missing | 0 (0) | 1 / 1 | 1 / 2 | 118 / 117 | 0 |
| Floor | prod-parity | s1 -9.31 host-auto; s2 -11.08 host-auto | 0 | 0 (100/100) | 0 | 12.1 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 2 | 119 / 120 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 -9.28 host-auto; s2 -11.02 host-auto | 0 | 0 (100/100) | 0 | 12 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 2 | 124 / 123 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 -9.24 host-auto; s2 -11.03 host-auto | 0 | 0 (100/100) | 0 | 12 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 2 | 126 / 117 | 0 |

### S7: buzzer: 20 answers in the final second, replies lost in the final 6s

Sources: R/{baseline,floor,c1,c3}/matrix.json row S7, and R/ARM/runs/S7-seed1.json and S7-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.43 resolve; s2 +0.43 resolve | 0 | 1 (82/83) | 0 | 60.4 (7.2) | 0.8 / 1.2 / missing | missing | 0 (0) | 1 / 1 | 1 / 3 | 126 / 127 | 0 |
| Floor | prod-parity | s1 +0.25 tv; s2 +0.21 phone | 0 | 0 (83/83) | 0 | 59 (9.9) | 0 / 0 / 0 | 4.5 | 0 (0) | 1 / 1 | 1 / 3 | 135 / 135 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.22 phone; s2 +0.24 phone | 0 | 2 (81/83) | 0 | 58.6 (9.6) | 0 / 0 / 0 | 2.6 | 0 (0) | 1 / 1 | 1 / 3 | 138 / 137 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.21 phone; s2 +0.23 phone | 0 | 1 (81/82) | 0 | 59.6 (6.8) | 0 / 0 / 0 | 1.7 | 0 (0) | 1 / 1 | 1 / 3 | 143 / 142 | 0 |

### S7s: S7 with slow answer writes, forced race

Sources: R/{baseline,floor,c1,c3}/matrix.json row S7s, and R/ARM/runs/S7s-seed1.json and S7s-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.41 resolve; s2 +0.43 resolve | 0 | 1 (82/83) | 30 | 78.4 (11.4) | 2.1 / 6.3 / missing | missing | 0 (0) | 1 / 1 | 1 / 3 | 127 / 127 | 0 |
| Floor | prod-parity | s1 +0.21 phone; s2 +0.21 phone | 0 | 1 (83/84) | 33 | 69.9 (7.3) | 0 / 0 / 0 | 1.7 | 0 (0) | 1 / 1 | 1 / 3 | 138 / 141 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.26 phone; s2 +0.26 phone | 0 | 2 (80/82) | 0 | 68.7 (7.3) | 0 / 0 / 0 | 2 | 0 (0) | 1 / 1 | 1 / 3 | 129 / 130 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.21 phone; s2 +0.22 phone | 0 | 3 (80/83) | 0 | 66.4 (7.1) | 0 / 0 / 0 | 1.6 | 0 (0) | 1 / 1 | 1 / 4 | 131 / 131 | 0 |

### S8: recovery: 15s outage for everyone, then all back at once

Sources: R/{baseline,floor,c1,c3}/matrix.json row S8, and R/ARM/runs/S8-seed1.json and S8-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.41 resolve; s2 +0.34 resolve | 0 | 0 (85/85) | 0 | 19.9 (15.6) | 12.8 / 0 / missing | missing | 0 (0) | 1 / 1 | 1 / 3 | 154 / 261 | 0 |
| Floor | prod-parity | s1 +0.21 phone; s2 +0.22 phone | 0 | 0 (85/85) | 1 | 27.6 (15.6) | 0 / 0 / 0 | 17.6 | 0 (0) | 1 / 1 | 1 / 3 | 96 / 206 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.22 tv; s2 +0.23 phone | 0 | 0 (84/84) | 0 | 26.5 (15.5) | 0 / 0 / 0 | 16.9 | 0 (0) | 1 / 1 | 1 / 3 | 138 / 219 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.22 phone; s2 +0.23 phone | 0 | 0 (85/85) | 0 | 27.5 (15.6) | 0 / 0 / 0 | 17.6 | 0 (0) | 1 / 1 | 1 / 3 | 131 / 199 | 0 |

### S9: the actual incident: 1 player, no TV

Sources: R/{baseline,floor,c1,c3}/matrix.json row S9, and R/ARM/runs/S9-seed1.json and S9-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (baseline) | prod-parity | s1 +0.54 resolve; s2 +0.53 resolve | 0 | 0 (2/2) | 0 | 14.1 (14.2) | 8 / 0 / missing | missing | 0.5 (0.1) | 1 / 1 | 1 / 3 | 19 / 43 | 0 |
| Floor | prod-parity | s1 +0.27 phone; s2 +0.25 phone | 0 | 0 (2/2) | 0 | 12.6 (13.3) | 0 / 0 / 0 | 6.6 | 0 (0) | 1 / 1 | 1 / 3 | 17 / 17 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.25 phone; s2 +0.30 phone | 0 | 0 (2/2) | 0 | 12.9 (13) | 0 / 0 / 0 | 6.9 | 0 (0) | 1 / 1 | 1 / 3 | 17 / 17 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.23 phone; s2 +0.25 phone | 0 | 0 (2/2) | 0 | 12.6 (13.2) | 0 / 0 / 0 | 6.6 | 0 (0) | 1 / 1 | 1 / 3 | 18 / 18 | 0 |

### S10: everyone offline across zero, 24s to 45s, nothing lands

Sources: R/{today-new,floor,c1,c3}/matrix.json row S10, and R/ARM/runs/S10-seed1.json and S10-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (today-new) | prod-parity | s1 +20.28 resolve (host press); s2 +20.26 resolve (host press) | 2 | 1 (84/85) | 0 | 55.3 (5.7) | 0 / 0 / 0 | 0 | 16.5 (44.3) | 1 / 1 | 2 / 4 | 145 / 289 | 0 |
| Floor | prod-parity | s1 +20.24 tv; s2 +20.25 tv | 0 | 1 (84/85) | 0 | 10.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 121 / 271 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +20.23 tv-tick; s2 +20.23 tv-tick | 0 | 0 (84/84) | 0 | 21.7 (21.6) | 0 / 0 / 0 | 7.8 | 0 (0) | 1 / 1 | 1 / 3 | 110 / 259 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +1.27 alarm; s2 +1.26 alarm | 0 | 1 (84/85) | 0 | 10.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 71 / 214 | 0 |

When each surface showed the question closed, in seconds after the deadline. Each value is closeRelDeadlineS plus surfaceRevealLagS from the run file (phones use the max, the last phone). Same mode rule as above.

| Arm | Seed | Database close | Last phone | Laptop | TV |
| :- | -: | -: | -: | -: | -: |
| Today | 1 | +20.28 | +21.25 | +20.33 | +20.70 |
| Today | 2 | +20.26 | +21.48 | +20.33 | +20.59 |
| Floor | 1 | +20.24 | +21.25 | +20.29 | +20.53 |
| Floor | 2 | +20.25 | +21.11 | +20.31 | +20.54 |
| C1 | 1 | +20.23 | +20.68 | +20.28 | +20.51 |
| C1 | 2 | +20.23 | +21.10 | +20.29 | +20.53 |
| C3 | 1 | +1.27 | +21.15 | +20.10 | +20.42 |
| C3 | 2 | +1.26 | +20.61 | +20.34 | +20.39 |

### S11: close calls dropped 20s to 40s, everything else passes

Sources: R/{today-new,floor,c1,c3}/matrix.json row S11, and R/ARM/runs/S11-seed1.json and S11-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (today-new) | prod-parity | s1 +22.99 end-early (host press); s2 +15.56 end-early (host press) | 2 | 0 (85/85) | 0 | 11.1 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 2 | 78 / 79 | 0 |
| Floor | prod-parity | s1 +17.69 tv; s2 +15.72 host (host press) | 1 | 0 (85/85) | 0 | 11.1 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 76 / 74 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +1.45 snapshot-tick; s2 +1.50 snapshot-tick | 0 | 1 (84/85) | 0 | 11 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 81 / 80 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +1.28 alarm; s2 +1.27 alarm | 0 | 1 (84/85) | 0 | 10.8 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 79 / 78 | 0 |

When each surface showed the question closed, in seconds after the deadline. Each value is closeRelDeadlineS plus surfaceRevealLagS from the run file (phones use the max, the last phone). Same mode rule as above.

| Arm | Seed | Database close | Last phone | Laptop | TV |
| :- | -: | -: | -: | -: | -: |
| Today | 1 | +22.99 | +23.38 | +23.04 | +23.41 |
| Today | 2 | +15.56 | +15.95 | +15.63 | +15.89 |
| Floor | 1 | +17.69 | +18.09 | +17.75 | +17.99 |
| Floor | 2 | +15.72 | +16.12 | +15.79 | +16.04 |
| C1 | 1 | +1.45 | +3.40 | +1.50 | +1.73 |
| C1 | 2 | +1.50 | +1.82 | +1.57 | +1.81 |
| C3 | 1 | +1.28 | +1.69 | +1.34 | +1.61 |
| C3 | 2 | +1.27 | +1.58 | +1.34 | +1.58 |

### S12: close broadcast lost, everything else passes

Sources: R/{today-new,floor,c1,c3}/matrix.json row S12, and R/ARM/runs/S12-seed1.json and S12-seed2.json for per-seed closes and row counts. C1 is repo-head, so its times compare with nothing here. The other arms are prod-parity, so their times compare.

| Arm | Mode | Close vs deadline (s) and who | Stuck | Lost on time (saved/tapped) | Unscored | Not Locked in s/run (worst phone s) | False wording s/run: didn't go through / couldn't confirm / false late | Still checking s/run (honest) | Hotspot screens/run (s/run) | Rows: resolve / reveal | Broadcasts: close / all | Peak req/s sent / landed | PG deadlocks |
| :- | :- | :- | -: | :- | -: | :- | :- | :- | :- | :- | :- | :- | -: |
| Today (today-new) | prod-parity | s1 +0.42 resolve; s2 +0.40 resolve | 0 | 0 (85/85) | 0 | 10.9 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 103 / 103 | 0 |
| Floor | prod-parity | s1 +0.25 phone; s2 +0.22 phone | 0 | 0 (85/85) | 0 | 11.1 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 109 / 109 | 0 |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C1 | repo-head | s1 +0.22 phone; s2 +0.24 phone | 0 | 0 (84/84) | 0 | 10.8 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 107 / 107 | 0 |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C3 | prod-parity | s1 +0.21 phone; s2 +0.23 phone | 0 | 0 (85/85) | 0 | 11.2 (0.3) | 0 / 0 / 0 | 0 | 0 (0) | 1 / 1 | 1 / 3 | 109 / 109 | 0 |

When each surface showed the question closed, in seconds after the deadline. Each value is closeRelDeadlineS plus surfaceRevealLagS from the run file (phones use the max, the last phone). Same mode rule as above.

| Arm | Seed | Database close | Last phone | Laptop | TV |
| :- | -: | -: | -: | -: | -: |
| Today | 1 | +0.42 | +0.84 | +0.56 | +0.65 |
| Today | 2 | +0.40 | +0.87 | +0.55 | +0.69 |
| Floor | 1 | +0.25 | +0.56 | +0.40 | +0.56 |
| Floor | 2 | +0.22 | +0.64 | +0.38 | +0.55 |
| C1 | 1 | +0.22 | +0.58 | +0.36 | +0.53 |
| C1 | 2 | +0.24 | +0.60 | +0.41 | +0.54 |
| C3 | 1 | +0.21 | +0.65 | +0.35 | +0.51 |
| C3 | 2 | +0.23 | +0.56 | +0.40 | +0.54 |

## 2. What each layer bought

### Floor against Today (both prod-parity)

Sources: R/baseline, R/today-new and R/floor, matrix.json and summary.txt.

| What | Today | Floor |
| :- | :- | :- |
| S5 close (reveal broadcast not heard, clocks fast) | +14.93..+15.74, host press, stuck 2 | +0.31..+0.32, phone, stuck 0 |
| Didn't go through, s/run | S2 87.8, S4 7.2, S7 0.8, S7s 2.1, S8 12.8, S9 8 | 0 in all |
| Couldn't confirm, s/run | S2 21.4, S4 11.6, S7 1.2, S7s 6.3 | 0 in all |
| Hotspot screens per run | S2 6.5, S9 0.5, S10 16.5 (44.35 s/run) | 0 in all 14 |
| S10 Not Locked in, s/run (worst phone) | 55.3 (5.7) | 10.9 (0.3) |
| S10 close broadcasts | 2 | 1 |
| S9 runs that closed 11s or more late | 2 of 6 (with the rechecks) | 0 of 2 |
| Laptop saw the close in S9, normal runs | +11.71..+12.01 | +6.40 |
| Close time where a phone or TV closes at zero | +0.34..+0.46 (S9 +0.53, +0.54) | +0.20..+0.32 |
| S11 close | +15.56..+22.99, host press, stuck 2 | +15.72..+17.69, stuck 1 |

Two rows need care.

S10 stuck went 2 to 0, but that is mostly a labelling change. Close time ties (+20.26..+20.28 against +20.24..+20.25). On b71ec25 there's no close log, so the fallback rule at PORTED.md:87 calls any close after the first press manual. Floor names the TV as closer from its log line, and its host still pressed once or twice (R/floor/runs/S10-seed1.json and seed2, manualEndCalls 2 and 1).

S11 stays late on the floor. Seed 2 still needed the host's press. The floor alone doesn't bring this case in on time.

Ties between Today and Floor:

- Time not Locked in. S2 245.7 against 251.2, S4 58.2 against 62.5, S7 60.4 against 59, S8 19.9 against 27.6, S1 32.8 against 32.2 s/run. The floor changed what the phone says, and not how long it waits. S2 now spends 117.4 s/run on Still checking, which is honest but still isn't Locked in. S7s (78.4 against 69.9) and S9 (14.1 against 12.6) lean the other way inside the same noise.
- Lost on-time taps: 5 of 1,284 against 3 of 1,285 (sum of matrix.json rows, arithmetic here). Every one was tapped between 24.94s and 25.00s (L/comparison/extract.out).
- S6 auto-end: -9.25..-9.23 by end-early against -11.08 and -9.31 by host-auto. C3 repeats the shape (-11.03, -9.24), so seed 2 running about 2s sooner isn't a one-off, but 2 seeds can't say why.
- S12: both close without a press and every phone sees it within 0.5s.
- Postgres deadlocks 0, resolve rows 1 and reveal rows 1 on every scenario.
- Clock-blocked taps in S5: 2 against 1.

Unscored went S7s 30 to 33 and S8 0 to 1. Treat both as ties. RUN.md says the S7s count measures nothing about frequency. The Floor agent's link between the earlier close and the S8 row is a guess.

### C3 on top of Floor (both prod-parity, so timings compare)

Sources: R/floor and R/c3 matrix.json, run files, and the S10 and S11 surface tables above.

| What | Floor | C3 |
| :- | :- | :- |
| S11 close | +15.72..+17.69, tv in seed 1, host in seed 2 | +1.27..+1.28, alarm |
| S11 stuck | 1 | 0 |
| S11 last phone saw it | +16.12..+18.09 | +1.58..+1.69 |
| S10 database close | +20.24..+20.25, tv | +1.26..+1.27, alarm |
| S10 last phone saw it | +21.11..+21.25 | +20.61..+21.15 |
| S10 laptop saw it | +20.29..+20.31 | +20.10..+20.34 |
| S10 TV saw it | +20.53..+20.54 | +20.39..+20.42 |
| S10 peak landed req/s | 271 | 214 |
| Unscored | S7s 33, S8 1 | 0 in all 14 |

S11 is the one clear timing gain. S10 is a database stamp only. The alarm finished the question about 2s into the 21s outage, and every surface then waited for the outage to lift. Phone reveal lag there was p50 19.03s (R/c3/runs/S10-seed1.json), so the room learned at about the same moment as on Floor. Both wins rest on after() sleeping through on `next start`. See section 5.

Unscored 0 fits the repair code in proto-c3.md, but the run files hold only the count, so that link wasn't traced.

Ties with Floor: S1 to S9 and S12 still close the same way at the same times (+0.20..+0.32, S6 by host-auto). Everything else matches within spread on those scenarios.

Lost taps: 3 against 7, all between 24.96s and 25.00s, with 3 of C3's in one S7s seed. That is small-count noise until shown otherwise, but it's the number to recheck with more seeds.

Load: Supabase calls per run rose by 9 to 172 in 12 of 14 scenarios and fell in S10 (-28) and S11 (-121.5). Requests per run in S11 fell from 930 to 796 (matrix.json rows, differences done here).

### C1 (repo-head, no same-mode floor)

Timings aren't compared. These are the raw values and the outcomes that can cross modes.

- S11: closed by snapshot-tick in both seeds at +1.45 and +1.50, stuck 0. Last phone +3.40 and +1.82. Seed 1's last phone took 1.95s after the close, and proto-c1.md says the snapshot that closes replies with the room as it was before the close. That link wasn't traced.
- S10: closed by tv-tick in both seeds at +20.23, stuck 0. The tick needs a request to land, so it fired only when the outage lifted.
- All 14 scenarios: stuck 0, deadlocks 0, one resolve row, one close broadcast, unscored 0.
- Unscored 0 can't be credited to the closer. Repo-head has the 25s trigger, and Floor + trigger was the arm meant to separate them.
- Lost taps 6 of 1,279, all refused as late at 24.98s to 25.00s. Mixed with the trigger, same reason.
- S10 seed 1 has one phone 21.57s from Locked in, and that run spent 15.6s on Still checking across all phones (R/c1/runs/S10-seed1.json). Seed 2's worst is 0.31s. Cause not traced, and no same-mode arm to compare.

The labels show one design difference that doesn't need timings. In S10 tv-tick waited for a request to land, and C3's alarm fired without one.

### C2

Missing. It has no scenario data on any metric. The only closer evidence is a rig script, not the harness: close at 26.006s (repo-head) and 26.007s (prod-parity) on a 1s loop, 0 of 40 forced races without exactly one winner, 20 claimers giving 1 claim (research/proto-c2.md, L/c2-rig-repo-head.json, L/c2-rig-prod-parity.json). Those ran at 22:32, on 7e44581. The head d8c3050 came at 22:58 and changed the migration by 36 lines (L/comparison-gitstat.txt), so they don't cover the head.

## 3. The incident, S9

Scenario: 1 player, no TV, tap at 9.75s, phone replies lost 8.4s to 21.4s, laptop routes cut off to 29.4s and its direct reads to 37.1s (harness/room/scenarios.mjs:58-66). Time to Locked in is lockedLagS max.

| Arm | Mode | Run | Time to Locked in (s after locked_at) | Auto-end calls | Host presses | Close vs deadline (s) | Who | Laptop saw close (s) | Didn't go through (s) | Couldn't confirm (s) | False late (s) | Still checking (s, honest) | Hotspot screens | Source |
| :- | :- | :- | -: | -: | -: | -: | :- | -: | -: | -: | :- | :- | -: | :- |
| Today | prod-parity | seed 1 | 13.93 | 0 | 0 | +0.54 | resolve | +11.99 | 8 | 0 | missing | missing | 1 | R/baseline/runs/S9-seed1.json |
| Today | prod-parity | seed 2 | 13.99 | 0 | 0 | +0.53 | resolve | +11.71 | 8 | 0 | missing | missing | 0 | R/baseline/runs/S9-seed2.json |
| Today (recheck) | prod-parity | seed 1 | 13.66 | 1 | 0 | +13.48 | end-early | +13.62 | 7.7 | 0 | 0 | 0 | 1 | R/today-recheck/runs/S9-seed1.json |
| Today (recheck) | prod-parity | seed 1 | 14.00 | 0 | 0 | +0.52 | resolve | +12.01 | 8 | 0 | 0 | 0 | 0 | R/today-recheck-s9/runs/S9-seed1.json |
| Today (recheck) | prod-parity | seed 2 | 14.02 | 0 | 0 | +0.55 | resolve | +11.71 | 8 | 0 | 0 | 0 | 1 | R/today-recheck-s9/runs/S9-seed2.json |
| Today (recheck) | prod-parity | seed 3 | 13.73 | 0 | 1 | +11.76 | end-early | +11.87 | 7.8 | 0 | 0 | 0 | 1 | R/today-recheck-s9/runs/S9-seed3.json |
| Floor | prod-parity | seed 1 | 11.77 | 0 | 0 | +0.27 | phone | +6.40 | 0 | 0 | 0 | 5.8 | 0 | R/floor/runs/S9-seed1.json |
| Floor | prod-parity | seed 2 | 13.27 | 0 | 0 | +0.25 | phone | +6.40 | 0 | 0 | 0 | 7.3 | 0 | R/floor/runs/S9-seed2.json |
| C1 | repo-head | seed 1 | 13.03 | 0 | 0 | +0.25 | phone | +6.47 | 0 | 0 | 0 | 7.1 | 0 | R/c1/runs/S9-seed1.json |
| C1 | repo-head | seed 2 | 12.68 | 0 | 0 | +0.30 | phone | +6.39 | 0 | 0 | 0 | 6.7 | 0 | R/c1/runs/S9-seed2.json |
| C3 | prod-parity | seed 1 | 13.20 | 0 | 0 | +0.23 | phone | +6.44 | 0 | 0 | 0 | 7.2 | 0 | R/c3/runs/S9-seed1.json |
| C3 | prod-parity | seed 2 | 11.89 | 0 | 0 | +0.25 | phone | +6.40 | 0 | 0 | 0 | 5.9 | 0 | R/c3/runs/S9-seed2.json |
| Floor + trigger | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |
| C2 | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing | missing |

Time to Locked in: tie. Today is 13.66 to 14.02s. The floor-code arms are 11.77 to 13.27s. The fault itself sets a limit of about 11.65s (21.4 minus 9.75, arithmetic here), since no reply can arrive before it lifts. In each of those arms the shorter run had 2 posts per tap and the longer had 3 (answerPostsPerTap in the run files).

Auto-end: it fired once in 12 finished runs, on Today (recheck seed 1, at +13.48). It didn't fire in any floor-code run. The laptop can't see the answer while it's cut off, so the question waits for timer zero and closes about 15.5s after the tap (arithmetic here). The real incident took 16.14s against the usual 1.87 to 2.64s (research/04-forensics.md:109). No arm restores a fast auto-end in this scenario.

False wording: Today shows "Didn't go through" for 7.7 to 8s in all 6 runs. The floor-code arms show 0, with 5.8 to 7.3s on Still checking instead.

Late close: 2 of 6 Today runs closed at +11.76 and +13.48, which RUN.md:165 traces to a phone hitting the hotspot screen just before zero. The floor-code arms went 0 of 6, all by phone at +0.23..+0.30. Six runs is too few to settle the rate.

The closers don't take part in S9. C1 and C3 tie Floor on every row of this table, and the question is closed by the phone in all of them.

## 4. Size, live database steps, tests

Sizes are `git diff --shortstat` at the commit each arm ran, saved in L/comparison-gitstat.txt. Candidates are measured on top of Floor, so shipping one means Floor plus that row. proto-c2.md and proto-c3.md quote older commits (7e44581, 312eb28); these numbers replace theirs.

| | Floor | C1 | C2 | C3 |
| :- | :- | :- | :- | :- |
| Range | b71ec25..5fefaa0 | 5fefaa0..b4f1086 | 5fefaa0..d8c3050 | 5fefaa0..3812ea6 |
| Outside tests/, files | 36 | 7 | 14 | 21 |
| Outside tests/, lines | +1,478 / -281 | +323 / -22 | +700 / 0 | +871 / -42 |
| tests/, files | 45 | 4 | 5 | 11 |
| tests/, lines | +4,376 / -182 | +731 / 0 | +854 / 0 | +1,759 / 0 |
| All, files | 81 | 11 | 19 | 32 |
| All, lines | +5,854 / -463 | +1,054 / -22 | +1,554 / 0 | +2,630 / -42 |
| Shortlist's guess | 450 to 550, about 12 files (floor-notes.md:5) | about 120 | about 150 SQL plus 250 app | about 250 |
| New migration | none | none | 20261104120000, 320 lines | none |
| Live database steps | none in the diff | 3 files already in the repo: 20261007180000, 20260915182433, 20260907134447 (shortlist.md:136, 160-166) | "five steps plus pg_cron" (shortlist.md:187): those 3, the new file, and the jobs | none (shortlist.md:244) |

C1's 323 includes 7 lines in vitest.db.config.ts (proto-c1.md). C2's 700 includes the 320-line migration. L/comparison-gitstat.txt shows no file under supabase/ for any arm except C2.

Tests, with counts as printed:

| Check | Floor | C1 | C2 | C3 |
| :- | :- | :- | :- | :- |
| Full vitest | 400 files passed; 3769 passed, 8 skipped, 0 failed (L/floor-full-2.log) | 3 failed, 398 passed files; 12 failed, 3782 passed, 8 skipped of 3802 (L/c1-full.log) | missing | 3 failed, 401 passed files; 12 failed, 3853 passed, 8 skipped of 3873 (L/c3-full.log) |
| Rig races | missing | repo-head: 4 failed, 39 passed of 43 (L/c1-races.log) | missing | prod-parity: 4 failed, 34 passed of 38 (L/c3-races.log) |
| Touched or related files | not separate | 8 files, 118 passed (L/c1-unit2.log) | 19 files, 172 passed at 7e44581 (L/c2-vitest-touched.log); 5 files, 64 passed at 22:58 (L/c2-review-fixes.log) | 87 files, 950 passed at 22:32 (L/c3-related-final.log); 5 files, 135 passed at 22:57 (L/c3-review-fix-after.log) |
| Harness arm | 28 of 28 runs | 28 of 28 runs | missing | 28 of 28 runs |

The 12 full-suite failures aren't from the candidates. The same 12 tests fail on the floor checkout at the same hour: 12 failed, 85 passed of 97 (L/c1-compare-wt-base.log, L/c3-compare-wt-base.log). All 97 pass with the clock shifted: L/c1-clockshift/shift-2.log (the amount is not recorded in the log, the file name suggests 2 hours back) and L/c3-shift.log (36 hours forward, L/c3-shift-setup.ts). So they depend on the time they're run. The cause wasn't pinned down. The three test files are api-auth-email-codes, api-auth-set-password, live-show.

Floor's log started at 22:08:42 on wt-base and states no commit. 5fefaa0 was committed at 22:11:23, so commit is missing for that run. L/floor-full.log (21:05) is 397 files, 3757 passed, 8 skipped, 0 failed, on f9bb30f per floor-notes.md:9.

C3's 4 rig failures are exactly the expected prod-parity set: 3 reset overlap tests plus the alias failure (research/08-test-rig.md, run A). The reset migration that clears them is one prod-parity skips.

C1's 4 rig failures are all `legacy_answer_deadline_passed` in live-answer-races. research/08-test-rig.md blames the test fixture against the trigger for that error (run C, 14 failures), and all 4 names are in L/rig-head-race-names.txt. C1's own legacy-close-race.test.ts passed 5 of 5, so the "never run" in proto-c1.md is out of date. The alias failure is gone from that run, and L/c1-venue-scale.log shows 45 of 45 passed. The FOR SHARE comparison the shortlist asked for wasn't found in any log, so it's missing.

## 5. What the harness can't prove

- Hand-ported devices. Every device in the room is a port in devices.mjs, and only four real modules come from the worktree (PORTED.md:7-14). C3 edited four ported client files: useAnswerSubmit.ts, useRoom.ts, useTVRoom.ts, the room page (research/proto-c3.md). But its arm ran plain floor.json and devices.mjs has 0 matches for scores-refetch or phone_stats. So those changes weren't in its arm.
- Stand-in REST. rest-standin.mjs is a hand-written stand-in for PostgREST (harness/README.md:83), one Node process with 10 database connections (RUN.md:169). Timings are behaviour on this stack, and shouldn't be read as production speed.
- Stand-in Auth. It's a stub that answers at once (harness/README.md:87).
- Stand-in Realtime. It has no channels, websocket or Postgres Changes (harness/README.md:89). Channel drops and rejoin aren't real here (PORTED.md:63), which is why the rejoin arms mattered, and those are missing.
- after() on Vercel. Local `next start` runs it, and proto-c3.md says that proves nothing about Vercel. Whether a 26s sleep finishes, and whether it finishes when the reply can't be delivered, is open (shortlist.md, "Still unverified"). Every C3 win in S10 and S11 is the alarm, so all of them hang on this. C2's drain also runs in after(), and C1's cap and freeze behaviour is unverified too (proto-c1.md).
- pg_cron at one second. Never used for real. The schedule ran against a stand-in cron schema in pglite, and the live project's pg_cron version wasn't checked (proto-c2.md). The harness's --db-tick would also be a stand-in, and that arm didn't finish.
- Real phones. No browser or real phone was used for any arm (floor-notes.md:90, proto-c3.md). Label fit on the TV is calculated.
- Real WiFi. Faults are scripted windows at a proxy. The landing rate at 50 phones during a blip rests on one phone's evidence (shortlist.md, "Still unverified"). The longest phone window in any scenario is 21s (S10, scenarios.mjs), so hotspot 0 on Floor shows the 45s hold working only for outages under 45s.
- Frequency. S7s proves the unscored race can fire, and says nothing about how often (RUN.md). Two seeds can't give rates anywhere.

## Addendum, 2026-11-05: the missing arms, rerun from the main session

The "missing" rows above are now filled by these runs. All exited 0. Files: R/c2, R/floor-trigger (full 14 scenarios, repo-head, C1's same-mode partner), R/floor-rejoin-on (S2,S4,S7,S8,S9,S10), R/today-final (S1 to S9, on the final harness, replacing R/baseline for comparison).

| Scenario | Today (final harness) | Floor | Floor + trigger | C1 | C2 | C3 |
| :- | :- | :- | :- | :- | :- | :- |
| S5 close | +14.86..+15.56 host press, stuck 2 | +0.31..+0.32 | +0.29..+0.33 | +0.29..+0.30 | +0.31 | +0.30..+0.31 |
| S7s unscored | 28 | 33 | 0 | 0 | 0 | 0 |
| S10 database close | +20.26..+20.28 | +20.24..+20.25 | +20.23..+20.26 | +20.23 | +1.27..+1.72 db-tick | +1.26..+1.27 alarm |
| S10 room saw it, last phone | +21.25..+21.48 | +21.11..+21.25 | not extracted | +20.68..+21.10 | +20.58..+21.32 | +20.61..+21.15 |
| S11 close | +15.56..+22.99 host press, stuck 2 | +15.72..+17.69, stuck 1 | +15.74..+17.66, stuck 1 | +1.45..+1.50 snapshot-tick | +1.09..+1.58 db-tick | +1.27..+1.28 alarm |
| S11 last phone saw it | +15.95..+23.38 | +16.12..+18.09 | not extracted | +1.82..+3.40 | +1.49..+2.84 | +1.58..+1.69 |
| Didn't go through, S2 s/run | 85.6 | 0 by design | 0 | 0 | 0 | 0 |
| Still checking, S2 s/run | n/a | 117.4 | 112.8 | 112.6 | 103.4 | 113.2 |
| Not Locked in, S2 s/run | 239.6 | 251.2 | 249.4 | 248.9 | 236.5 | 247.4 |
| On-time taps lost, whole matrix | 5 of 1,285 (today-final + today-new) | 3 of 1,285 | 6 of 1,283 | 6 of 1,279 | 8 of 1,284 | 7 of 1,283 |

Lost taps were all in the last 60ms before the deadline. Counts this small are noise at 2 seeds.
C2's matrix ran 1,384 ticks with 0 errors, on a 1s loop standing in for pg_cron.
Floor + trigger shows the trigger alone clears unscored (S7s 33 to 0) and closers add nothing there. It does nothing for S11 (still +15.74..+17.66, stuck 1).
Rejoin read on: Not Locked in S2 250.5, S4 55.7, S8 19.3, S10 11.1, against 251.2, 62.5, 27.6, 10.9 with it off. No outcome changed; S7 showed 1 unscored on prod-parity, in line with the known race.
All three closers acted only in S10 and S11. In S10 C2 and C3 closed about 19s before anyone could see it, so the room's experience ties with Floor and C1.

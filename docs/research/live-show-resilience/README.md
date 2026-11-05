Saved so this work can be picked up later. Please don't merge yet: nothing here is approved, and nothing here is live.

## Where this stands

After the Social Media $500 moment in the November test, we built and tested fixes for answers that save but lose their reply. Brandon still has to pick what ships.

My pick is the shared fixes first, then Option 1. All three options tied in testing, and Option 1 is the smallest and safest.

## What's saved

- This PR: the shared fixes (first 9 commits) plus Option 1, crowd close (10th commit), plus notes in `docs/research/live-show-resilience/`.
- Branch `proto/c2`: shared fixes plus Option 2, the database clock.
- Branch `proto/c3`: shared fixes plus Option 3, the server alarm.
- Branch `proto/base`: the shared fixes alone.

The test rig and the notes on real show data stay on Brandon's Mac in `~/Developer/tr1via.com/prototypes/`, because this repo is public.

## The options

| Option | How it closes | Closed at | Size | Main risk |
|---|---|---|---|---|
| 1. Crowd close (pick) | Next phone check-in after the deadline | +1.5s | 323 lines, plus 3 database changes already written | Needs a phone to get through |
| 2. Database clock | The database checks every second | +1.1 to +1.7s | 700 lines, 320 of them a new database change | Never run on this project, and nobody at a show could stop it |
| 3. Server alarm | Alarm set when the question starts | +1.3s | 871 lines | Relies on Vercel finishing a sleeping task, which is unproven |

Those times are for the gap all three cover: phones' close calls fail while other traffic lands. Today that closes 16 to 23s late and needs the host.

## Test results

All from a local simulator with 50 phones.

- False "Didn't go through" on phones: 85.6 phone-seconds per run down to 0. Those phones now say "Still checking".
- A question stuck until the host pressed the button at about +15s now closes itself at +0.3s.
- Unscored answers in a forced test: 28 down to 0 with the database scoring rule.
- Simulator: 28 of 28 runs per option.
- Main test suite on this branch: 12 failed, 3782 passed, 8 skipped of 3802. Those 12 also failed on the shared fixes at that hour and passed at other times. They look clock dependent, but the cause isn't pinned down.
- Database race tests on this branch: 4 failed, 39 passed. A known setup error stops those 4 early, so those races weren't exercised with the 25-second rule on.

## Not tested

- All the devices were simulated, with no real browser or WiFi. Supabase was a local stand-in too.
- Only 2 repeats of each scenario.
- The end-to-end browser tests weren't run.
- Option 2's one-second job and Option 3's alarm never ran on the real services.

## Before this can ship

1. Brandon picks an option.
2. Fix the setup error in the 4 race tests and rerun them.
3. Find out why the 12 tests fail at some hours.
4. Run it in a real browser, on real phones.

## Rollout order

Each step needs Brandon's go, and none happens on a show day.

1. Shared fixes, then the diagnostics database change, alone for one show.
2. The scoring rule. This changes a player rule: an answer arriving after close is refused instead of stored unscored.
3. The reset fix.
4. Crowd close in watch-only mode for one show, then on.

`LIVE_CLOSE_MODE` (the crowd close setting) is off unless it's set.


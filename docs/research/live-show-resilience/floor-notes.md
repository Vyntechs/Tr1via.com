# Shared floor notes

Branch proto/base in wt-base, commits 3b5c07b to f9bb30f on top of b71ec25. Local only. Nothing is pushed or deployed.

Size: 78 files, +5349 / -458. App code is 36 files, +1431 / -277. Tests are 42 files, +3918 / -181. The shortlist guessed 450 to 550 lines and about 12 files, so the app code came in at about 2.6 times the top of that estimate. Most of the excess is host-side: B7 and B8 alone added 416 lines.

## Final check on f9bb30f

- `npx vitest run`: 397 files passed, 3757 tests passed, 8 skipped, 0 failed. Baseline was 385 files, 3532 passed, 8 skipped, 0 failed. Log: logs-proto/floor-full.log
- `npx tsc --noEmit`: exit 0, no output.
- The vitest config covers tests/unit, tests/component and tests/integration. tests/concurrency and tests/e2e are outside it, so this run did not touch them, including the edits listed below.

## What changed per B item

B1, late lookup (3b5c07b). app/api/answers/route.ts, +63 / -14. A late answer now looks for a saved row before refusing. A saved row gets 409 "already answered". No row gets the `late_refusal` log line and the 400. The TR025, TRCL0 and TRNL0 insert-error branches run the same lookup.

B2, honest phone wording (5668984). lib/hooks/useAnswerSubmit.ts, components/player/PlayerSendStatus.tsx, PlayerLocked.tsx, PlayerQuestion.tsx and the room page. A late 400 shows the late line only if it was the one send and nothing else is out. The stored answer survives zero until a snapshot shows the row or the reveal. No resend button after close.

B3, resends that can beat zero (5668984). lib/hooks/useAnswerSubmit.ts. Quiet resends fit the time left and stop under 750ms. The on-screen status keeps its own 6s timer. B2 and B3 together are +153 / -52.

B4, hotspot screen held back (89d527c, tidied in 93c233b). lib/realtime/reachability.ts, lib/room/recentJoin.ts, the room page, ConnectionRibbon.tsx, ConnectionRibbonProvider.tsx. 45s on the game before the hotspot screen. "Reconnecting" for a reloaded phone with a saved join. The ribbon stays soft until 25s. "Held locally" is gone.

B5, same rule on the laptop (e066975). components/host/HostConnectionBanner.tsx, lib/hooks/useRoom.ts. Amber "Slow connection. Game still live." for 45s with a room in memory. Unreachable only after two failed polls in a row.

B6, calm TV (f9bb30f). +61 / -19 across four files.
- app/tv/[code]/page.tsx, +14 / -12. Message screens only render with no snapshot, so a failed poll keeps the last frame. A real 404 still clears the room and shows "Game not found".
- lib/hooks/useTVRoom.ts, +14 / -3. A safety poll skips when a request is in flight and under 5s old. Past 5s it replaces the request, which matters because the 5s bound on fetch doesn't cover a stuck reply body. Broadcasts and `refresh` still abort and restart.
- components/tv/TVQuestion.tsx, +18 / -4. TIME'S UP at zero in every theme, plus a `lockingIn` prop that swaps the label to "Locking in answers". The label is forced onto one line, and November drops to 10px for that label only. By estimate from character widths, 18 characters at November's 12px is about 164px in a 150px column, and that row clips a second line.
- components/tv/TVStateMachine.tsx, +15 / 0. A plain local setTimeout 3s after the timer reads zero. No network involved. It resets if the timer leaves zero (undo and replay of the same question). `!question.finishedAt` keeps the wording off the ceremony hold.
- /tv and the panel at HostLiveConsole both run this same TVStateMachine code, and a test covers each.

B7, host buttons (d882368). lib/host/hostFetch.ts, lib/hooks/useSentChecking.ts, components/host/HostSentChecking.tsx, HostLiveConsoleClient.tsx, HostPhoneClient.tsx, lib/hooks/useAllLockedAutoReveal.ts, lib/host/roomToTVSnapshot.ts. 8s bound, no auto-retry, "Sent, checking" and a re-read. Auto-end retries at 1.2, 2.4 and 4.8s, then stops.

B8, host polls (d882368, e066975). lib/host/hostPollLoop.ts, HostLiveConsoleClient.tsx, lib/hooks/useRoomRoutePoll.ts, lib/hooks/useRoom.ts. One read in flight with a 4s abort. The route poll starts on the first missed direct read with its own abort. B7 and B8 in d882368 are +416 / -78. B5 and B8 in e066975 are +87 / -27.

B9, timer-zero ladder (3b5c07b for `retryInMs`, 4fd2b96 for the rest). lib/game/resolveAtZero.ts, lib/hooks/useResolveAtZero.ts, lib/hooks/useTimer.ts, app/api/questions/[id]/resolve/route.ts, TVStateMachine.tsx, the room page, plus `receivedAtMs` plumbing through useRoom, useTVRoom and the host surfaces. 4fd2b96 is +276 / -41.

B10, one winner on end-early (3b5c07b). app/api/games/[id]/end-early/route.ts, +75 / -24. Plain reads for "everyone answered", both branches close through resolve_question_once, broadcast only for the winner.

B11, undo refuses a finished question (3b5c07b). app/api/games/[id]/undo/route.ts, +10 / -1.

B12, spread recovery (89d527c). lib/hooks/useRoom.ts. One read at a random 0 to 2,000ms after a channel rejoin or a return to reachable. Question-event reads stay immediate.

B13, say who closed it (3b5c07b). lib/live/logClose.ts, the close routes, and a caller header to /resolve. **Half of this item is missing:** the post-show query run by an automated job is not in the diff.

B14 (3b5c07b). Fixture fix in tests/concurrency/live-answer-races.test.ts and the contract test tests/unit/answer-deadline-contract.test.ts. The proxy harness lives under harness/, outside this branch.

B15 is rules around shipping. No code.

## Existing tests updated, and why

B6 changed no existing assertion. tests/unit/useTVRoom-snapshot-lifecycle.test.tsx only gained cases. A search of tests/ found nothing pinning "Something's off" or "FINAL SECONDS" at zero.

Earlier commits, read from the diff of each file:
- tests/component/PlayerLockedSendStates.test.tsx, PlayerQuestionInPlaceLock.test.tsx, tests/e2e/phone-instant-lock.spec.ts, tests/unit/player-answer-signed-refresh.test.tsx: pinned "Didn't go through, retrying" and "We couldn't confirm your answer", which B2 replaces.
- tests/unit/answer-submit-instant-lock.test.tsx, answer-submit.test.tsx: pinned the stored answer clearing at zero. B2 keeps it.
- tests/unit/connection-ribbon.test.tsx, tests/e2e/connection-unreachable.spec.ts: pinned instant hotspot guidance. B4 holds it back.
- tests/unit/api-answers-route.test.ts, api-answers-diagnostic-log.test.ts: pinned refusal before the player lookup. B1 moves it after.
- tests/unit/api-end-early-route.test.ts: three tests pinned resolve_question_if_all_locked. B10 removes that call.
- tests/unit/api-resolve-route.test.ts, api-public-finalize-route.test.ts: pinned exactly one log line. B13 adds the close line.
- tests/unit/theme-fence.test.ts: pinned the old inline timer-zero fetch in TVStateMachine. B9 replaces it.
- tests/component/HostLiveConsoleClient.adjustment, .catch-up and .stale-counts tests: their fake database reads needed the new abortable read chain (B8).
- tests/component/HostPhoneClient.test.tsx: pinned `{ method: "POST" }` exactly. hostFetch adds an abort signal (B7).
- tests/unit/useRoom-host-catch-up.test.tsx: dropped its stand-in for useRoomRoutePoll so the real one runs (B5, B8).
- tests/concurrency/live-answer-races.test.ts: fixture needed `locked_at` (B14).
- tests/e2e/helpers/selectors.ts: one new selector.

## New B6 tests

All use fake timers and the real code.
- tests/component/TVTimerZeroLabels.test.tsx, 18 tests. Real TVStateMachine, useTimer and ladder with every fetch failing. All 14 themes, the host panel, close arriving, the ceremony hold, undo and replay. The hold test forces only the hold decision, because a real hold ends at 3s, the same moment the wording would appear.
- tests/unit/tv-page-last-frame.test.tsx, 3 tests. Real page with real useTVRoom. Channel and heavy TV children are stand-ins.
- tests/unit/useTVRoom-snapshot-lifecycle.test.tsx, 7 added. Slow reply lands, first load, stuck body, broadcast restart, three kinds of failed poll.

Targeted run: 6 files, 57 tests passed. Against the four old source files, 24 of those 57 failed (logs-proto/tv-oldcode.log). The rest are older tests or new checks that should pass on old code too, such as "room is gone". Removing the `!question.finishedAt` check failed the hold test and nothing else in that file (logs-proto/tv-mut.log). Both changes were undone before the commit.

## Stubs check on b71ec25..HEAD

4,750 added lines searched.
- App code: no TODO, FIXME, placeholder, stub, mock, fake, dummy, debugger or console.log. No NODE_ENV, process.env or test-only switches, no eslint-disable, no ts-ignore.
- Tests: no added .skip, .only, xit, .todo, TODO or ts-ignore. None removed either.
- The 8 skipped tests match the baseline count. The diff adds no skip, and the tree has `describe.skip` in welcomeChime and thunder plus `describe.skipIf` in three integration files.
- Deliberate stand-ins, test-only: the TV children and the Supabase channel in tv-page-last-frame, and the forced hold in TVTimerZeroLabels.

## Open items

- B13's post-show query job is not built.
- harness/room/PORTED.md:28 and devices.mjs:610 still model "new poll aborts the old". The harness can't show the B6 poll skip until someone ports it, so the vitest tests are the only proof for now. wt-harness was left alone as the brief requires.
- The wording shows when a `resolve` broadcast was heard but the snapshot behind it failed. The view only learns of a close from the snapshot. "Locking in answers" is still true there, so I left it.
- No browser check of B6. Label fit in November is calculated, not seen, and no real TV or laptop was used.
- A TV that reloads long after zero counts its 3s from when it loaded, so it shows TIME'S UP for 3s first.
- eslint on the seven B6 files reports 3 errors and 2 warnings, all on lines older than this work (TVQuestion.tsx:123 and :157, page.tsx:159 and its neighbours).
- This job did not run tests/concurrency or tests/e2e.

# Live-Night Handoff — 2026-07-09 (Heather's show, full house ~38)

Handoff from the standby/remote session (no DB access) to a **local session with DB
access**. Everything below was diagnosed live during Heather's Wednesday show.
**Nothing has been changed or deployed.** Working tree is clean; branch is
`claude/trivia-night-support-3rj9cj` at `fcd4fc4`.

Product rule that governed everything tonight: **never deploy to prod during a live
show.** Prod = `main` (merge-to-deploy). Pushing this branch is preview-only and safe.
There is **no client auto-reload / version check / service worker** in the app, so any
client-side fix only reaches a device when it reloads.

---

## 1. Do these FIRST — they need the DB access this session has

These are the things the remote session could NOT verify and that matter for tonight:

1. **Settle the "who's the leader" dispute.** Query `game_scores` for the current/last
   game ordered `score DESC` (see §3 tie-break — order by the deterministic keys, not
   score alone). Report the true top few. A player disputed their "Where you stand"
   rank; the on-phone ranks were unstable (see Issue A).
2. **Check for duplicate player rows.** Founder was playing as **"Yo Mama"** and showed
   0 pts + wrong standing. Look for multiple `players` rows for his device / duplicate
   `display_name`, and whether his real answers landed on a different `player_id` than
   the one his phone is pinned to (`me.id`). Confirms whether his "0" was a duplicate-row
   artifact vs. genuinely wrong answers.
3. **Confirm data integrity (validates that tonight's issues were display-only).** Spot
   check that `resolve_question` wrote `is_correct` + `awarded_points` correctly for a
   few resolved questions (esp. the "makeup" question). Expectation: DB is correct; the
   bugs were all in the reveal/standings *rendering*.
4. **Room config.** Read `nights` for this night: `room_magic_enabled` and `theme_key`
   (today is July → expect the `july` theme + fireworks lock-in ceremony). Founder asked
   whether "player magic" was on; it's a per-**night** flag, not per-game.
5. **Make-good candidates.** The late-question issue (Issue D) can cost real answers.
   If any players got a materially short answer window, consider the `adjustments` path
   to compensate. DB access lets you see who answered late / not at all per question.

---

## 2. The fix bundle

Founder approved shipping the **safe cosmetic set only** between games / after the show.
The higher-risk perf fix (Issue D) is explicitly **held** for a proper PR.

### Issue A — Standings "Where you stand" disagree across phones (COSMETIC)
- **Symptom:** multiple players reported their rank/order was wrong; two surfaces
  (phone vs TV) disagreed; ranks shuffled between refetches.
- **Root cause:** standings are ordered by `score DESC` with **no tie-breaker**, so tied
  rows come back in arbitrary, inconsistent order. Each phone computes its own rank via
  `findIndex(player_id === me.id)` against a differently-ordered tie block. Worst early in
  a game when many are tied. **Scores themselves are correct** — only the display order
  among equal scores is unstable.
- **Fix:** deterministic multi-key ordering **everywhere standings are ranked** (see §3).

### Issue B — "Nobody nailed this one" shows when people got it right (COSMETIC)
- **Symptom (on Heather's mirrored console):** reveal paints the stumper
  "TOUGH ONE / Nobody nailed this one" when players actually answered correctly.
- **Root cause:** `components/tv/TVStateMachine.tsx:646-648`
  ```js
  const correctAnswers = answers.filter((a) => a.is_correct);
  const stumper = correctAnswers.length <= STUMPER_THRESHOLD; // ≤ 4
  ```
  At the instant of resolve, the held snapshot still has `is_correct === null` (it is
  deliberately **withheld until the question is resolved** — anti-cheat, see
  `app/api/tv/[code]/snapshot/route.ts:258`). `null` is falsy → `correctAnswers` = 0 →
  false stumper. Should self-correct on the next snapshot, but under tonight's DB load
  the corrected snapshot lagged. Compounded by `STUMPER_THRESHOLD = 4`
  (`TVStateMachine.tsx:63`): even 4-of-38 correct forces the "tough one" layout.
- **Fix (conservative):** distinguish *ungraded* (`is_correct === null`) from
  *graded-wrong* (`false`). Only pick the stumper from graded data; if answers exist but
  none are graded yet, hold a neutral frame instead of painting the zero/empty state.
  ```js
  const answers = snapshot.liveAnswers;
  const graded = answers.filter((a) => a.is_correct !== null);
  const correctAnswers = answers.filter((a) => a.is_correct === true);
  const gradingPending = answers.length > 0 && graded.length === 0;
  // if (gradingPending) render a neutral "revealing…" frame, NOT the stumper empty state
  const stumper = !gradingPending && correctAnswers.length <= STUMPER_THRESHOLD;
  ```
  Also reconsider `STUMPER_THRESHOLD` for full-house nights (4-of-38 shouldn't read as a
  stumper). Add/extend a test alongside `tests/unit/tv-snapshot-route-answer-gating.test.ts`.
  **Risk:** low but it is logic in the reveal path — test before shipping.

### Issue C — Fact blurb / "little comment" too small to read (COSMETIC / CSS-only, lowest risk)
- **Symptom:** Heather squints to read the post-answer comment on her mirrored console.
- **Root cause:** font sizes tuned for a distant venue TV, tiny on the scaled-down
  laptop-mirrored view. Smallest exactly on the stumper screen she kept landing on.
- **Fix (pure CSS):**
  - `components/tv/TVReveal.tsx:148` — fact `fontSize: 22` → **28**
  - `components/tv/TVRevealStumper.tsx:149` — fact `fontSize: 15` → **24**
  - `components/tv/TVRevealStumper.tsx:236` — pointBlurb `fontSize: 12` → **16**
  - (facts have `maxWidth` set, so larger size just wraps — check it doesn't overflow the
    card vertically on a real 16:9 TV.)

### Issue E — Intermission join QR is tiny (COSMETIC / CSS-layout)
- **Symptom:** between-games "Join round 2" QR on the host/TV is tiny, tucked under the
  "38 of 38 players" count.
- **Root cause:** `components/tv/TVIntermission.tsx:209` — `<QRBlock url={joinUrl}
  size={110} light />`, sitting in the right column beneath the size-96 ready count.
- **Fix:** bump `size` substantially (≈ **260+**) and/or restructure the right column so
  the QR isn't crammed under the count. Compare against the lobby QR
  (`clamp(240px,40vh,460px)`) for the target scale.

### Issue D — Question displays LATE → players get little time (HELD, real gameplay impact)
- **Symptom:** some phones show the question late and have little/no time to answer.
- **Root cause:** timer is **server-timestamp-anchored** (`lib/game/timer.ts`) —
  `remaining = 30 − (now − revealed_at)` on every device, by design for cross-surface
  sync. If the reveal reaches a phone late (missed the fire-and-forget broadcast on
  congested venue WiFi → recovered via the slower Postgres-changes / snapshot poll /
  ~15s heartbeat), the lost transit time is subtracted from its 30s. Aggravated by the
  refetch storm below.
- **The real lever — the refetch storm:** `app/(player)/room/[code]/page.tsx:434-451`
  subscribes to `answers`/`adjustments`/`game_participations` with **no filter**, so all
  ~38 phones re-run the `game_scores` query on *every* answer (~38×7 ≈ hundreds of
  refetches/question). That DB/Realtime pressure delays reveal delivery → late paint.
- **Fix (do as a proper PR — NOT a hot ship):** filter/debounce that subscription so
  phones aren't hammering the DB on every answer. Optionally add a small per-device
  minimum-answer-window grace, and ensure the question card paints without waiting on the
  Pexels image. Touches the live sync path all players depend on → full test pass +
  preview verification before prod.

---

## 3. Tie-break — apply the SAME order at every ranking site (fixes Issue A)

Canonical order: **`score DESC, correct_count DESC, fastest_correct_ms ASC NULLS LAST,
player_id ASC`.** Recommend a shared helper so SQL and JS agree exactly, e.g.
`lib/game/standings-order.ts` exporting a JS comparator + a PostgREST `.order()` applier,
then use it everywhere below.

PostgREST `.order("score", {ascending:false})` sites — add the extra keys:
- `app/(player)/room/[code]/page.tsx:429` (current game)
- `app/(player)/room/[code]/page.tsx:1429` (game-1 standings for between-games)
- `app/(player)/room/[code]/page.tsx:2024`
- `app/(player)/room/[code]/recap/page.tsx:72`
- `app/(player)/room/[code]/won/page.tsx:62`
- `app/host/live/[nightId]/HostLiveConsoleClient.tsx:166`
- `app/api/room/[code]/snapshot/route.ts:173`

JS `.sort((a,b) => b.score - a.score)` sites — replace with the shared comparator:
- `app/host/live/[nightId]/HostLiveConsoleClient.tsx:296`
- `lib/host/roomToTVSnapshot.ts:134`
- `app/api/tv/[code]/snapshot/route.ts:203`

Already has a join-order tiebreak (align it to the canonical keys):
- `components/tv/TVScoreboardMarquee.tsx:196`

Note: the `game_scores` view (`supabase/migrations/0013_game_scores_per_game_isolation.sql`)
already exposes `correct_count`, `answered_count`, `fastest_correct_ms` — no migration needed.

---

## 4. Deploy discipline & mechanics
- **No prod deploy during a live show.** Between-games (~15 min) is acceptable for the
  safe cosmetic set; after-show is best for Issue D.
- **No auto-reload exists.** Client-side fixes (A, and the phone side generally) only
  reach a device on reload. Between games, the play that works: Heather refreshes her
  console (picks up C + B on the mirror) and tells the room "refresh your phone for round
  2" (players pick up A); new QR joiners get everything automatically. `handleJoin`
  (`page.tsx:1471`) is an in-place fetch — it does **not** reload the bundle.
- **Rollback:** the previous prod deployment is a rollback candidate — faster/safer than a
  forward fix if a live deploy ever regresses.
- **Verify skill / tests:** run `npm test` + `npx tsc --noEmit` before any push. Known
  baseline: 2 pre-existing tsc errors in `HostHomeClient-founder-build.test.tsx` (noise).

## 5. Suggested order of operations
1. Run the §1 DB checks; report the true leader and resolve the duplicate-row question.
2. Implement C + E (pure CSS, zero logic risk).
3. Implement A via the shared helper across all §3 sites; add/adjust standings tests.
4. Implement B with the grading-pending guard; add a test.
5. Land 2–4 as one PR after the show; verify on the preview deploy; then merge to `main`.
6. Do D as its own PR with a full test pass — do not bundle it with the cosmetics.

## Git state
- Branch: `claude/trivia-night-support-3rj9cj` (clean, at `fcd4fc4`).
- No code changes staged — all of the above is spec, not yet implemented.

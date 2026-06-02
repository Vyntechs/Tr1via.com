# Lessons

> Curated by the `lesson-keeper` subagent per workflow §3. Each lesson must be a non-obvious pattern with Trigger / Rule / Reason, each ≤ 25 words. Hard cap: 40 active lessons; overflow moves to `lessons-archive.md`.

### realtime-zombie-after-sleep
Trigger: Host/player screen frozen on a stale view; F5 doesn't fix it; fully quitting the browser does.
Rule: Chrome's WebSocket can zombie (connected but silent) after laptop sleep. Our 3 safety nets trust socket status, not data freshness. Add a "received-anything-recently?" watchdog.
Reason: the first host's go-live lost a whole section to a 215s host freeze; refresh keeps Chrome's broken socket pool, only full quit clears it.

### view-leftjoin-filter-trap
Trigger: Aggregating (SUM/COUNT) across a LEFT JOIN that has a filter in its ON clause.
Rule: A filter in a LEFT JOIN's ON clause nulls the right-side columns but KEEPS the left rows — aggregates still include them. Filter in WHERE instead.
Reason: game_scores summed both games' awarded_points into every game's row because `AND c.game_id = gp.game_id` only nulled categories, didn't drop the answer rows.

### trust-client-data-over-async-echo
Trigger: A UI right/wrong (or similar binary) decision gates on a server-computed field that arrives asynchronously.
Rule: Decide from data already on hand (e.g. chosen_index vs correct_index) OR'd with the server echo. Don't gate solely on the slow-to-arrive field.
Reason: players who answered correctly saw "Not this one" because `is_correct` was still null when the reveal rendered (`null === true` is false).

### prove-rootcause-from-timestamps
Trigger: A plausible eyewitness theory for a prod incident ("the laptop kept sleeping").
Rule: Confirm with DB timestamp patterns before accepting. Variance (stddev), not just mean, distinguishes intermittent failure from gradual slowdown. Quantify engagement impact too.
Reason: Brandon pushed back on the hand-waved theory; game1 stddev 8s vs game2 40s (5×) plus a 30-40% answer-count drop made the case.

### stay-on-the-named-problem
Trigger: User asks about ONE specific problem while the HANDOFF/memory holds a list of other open issues.
Rule: Answer only the named problem. Do not bundle adjacent backlog items pulled from memory; a rich open-items list creates a pull to over-scope.
Reason: Brandon narrowed to just the freeze; I dragged in Molds/regenerate from the handoff and he had to redirect me.

### reason-scale-free-not-observed-count
Trigger: Reasoning about a fix's safety/load using the player count from one show (e.g. "the 23 phones").
Rule: State guarantees independent of N. Make the risky path O(1) (host-only), keep per-client load unchanged, add jitter, and load-test a range — never one number.
Reason: Brandon corrected anchoring to 23 phones; reconnect-stampede risk scales with N, so a guarantee true only at the observed count is worthless for future bigger shows.

### prod-gate-needs-local-dev-for-undeployed
Trigger: Running a prod-driver gate (full-flow / validate-*) for a feature that adds a new API field/behavior not yet merged+deployed.
Rule: Point the driver at a local dev server over prod Supabase (`SMOKE_BASE_URL=http://localhost:3030`, `npm run dev`). The default `tr1via.com` runs deployed `main` and 400s any new field.
Reason: PR-first means my branch is never on prod; the reroll driver 400'd "Unrecognized key 'keptIds'" against tr1via.com until pointed at local dev — then GREEN end-to-end.

### e2e-target-testid-not-visible-copy
Trigger: Writing or reviewing a Playwright/e2e selector that matches an element by its visible button/label text.
Rule: Target a `data-testid` via the central registry (`tests/e2e/helpers/selectors.ts`), never visible copy. If the element lacks a testid, add one. Copy is product UX and churns.
Reason: prod-ui-smoke clicked the login button by `/send sign-in link/i`; a May-25 copy rename to "Sign in →" silently rotted the post-merge-only prod smoke red for days before Brandon noticed. (PR #61)

### tee-masks-pipeline-exit-code
Trigger: Running a pass/fail driver (full-flow, validate-*) in the background piped through `| tee log`.
Rule: Don't pipe through `tee` — the completion notification reports `tee`'s exit (0), hiding a real failure. Redirect with `> log 2>&1` so the exit code is the script's own.
Reason: full-flow piped to tee reported "exit code 0" while its log said FULL FLOW RED; I nearly reported a false GREEN before grepping the log.

### full-flow-driver-runs-as-founder-collision
Trigger: A driver prod run "fails" with game/night state reset or wiped mid-run, and you can't find a code path that did it.
Rule: `full-flow-prod.mjs` logs in as the FOUNDER (brandon@vyntechs.com), so its night becomes "tonight" in the real host dashboard. Concurrent host-UI actions (e.g. "Reset and edit game") hit the driver's night. Check Vercel logs for an external call before blaming the app; give the driver a dedicated `@tr1via.test` host.
Reason: A run "failed" with game 1 wiped; logs showed a host-UI `reset-to-setup` 200 on the founder's night mid-run — a coincidental collision, not a bug. I'd wrongly called it a "pre-existing prod bug."

### stale-blocker-from-old-todo
Trigger: A prior session's `tasks/todo.md` or `HANDOFF.md` lists a bug/blocker on a prod-facing surface.
Rule: Re-verify against live prod before repeating it to Brandon as current state; never present a stale note as today's reality.
Reason: Repeated a "/tv/[code] is crashing" blocker from the old Tonight's Topics todo without checking; Brandon confirmed prod was fully functional. Violates validate-don't-claim.

### hoisting-a-side-effect-hook-changes-when-it-fires
Trigger: Moving a `useEffect` (timers/subscriptions) above an `if (!x) return null` guard to fix a hook-count crash.
Rule: Gate the effect BODY on the same condition AND add it to deps — else it fires against the empty render before the gated subtree mounts.
Reason: TVFinaleWinner's hoisted finale-lightning timers ran with no winner → no Lightning mounted; it seeded its trigger ref past the strikes and the May finale played nothing.

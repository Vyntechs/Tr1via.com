# Lessons

> Curated by the `lesson-keeper` subagent per workflow §3. Each lesson must be a non-obvious pattern with Trigger / Rule / Reason, each ≤ 25 words. Hard cap: 40 active lessons; overflow moves to `lessons-archive.md`.

### shipped-is-by-content-not-commit-hash
Trigger: About to say a branch's work "never shipped / isn't on main / is behind" based on `git log main..branch` or `is-ancestor`.
Rule: Squash/rebase merges land content under a NEW hash, so originals show "missing" by hash. Verify by content: `git diff main branch -- <file>` (empty = shipped).
Reason: Told Brandon July fireworks "never shipped" (live via squashed #110) — false, contradicted what he'd seen, triggered a needless risky cross-branch rebase.

### git-stat-cache-phantom-on-volumes
Trigger: cherry-pick/rebase on a `/Volumes` (external/network) checkout aborts with "local changes would be overwritten" but `git diff` is empty.
Rule: Stale stat-cache, not a real diff. Clear with `git update-index -q --refresh` or `git checkout -- <file>`, then continue.
Reason: Burned 3 attempts on a phantom diff during a cherry-pick before refreshing the index fixed it.

### creating-row-early-skips-routing-gate
Trigger: Asked to "set field X on the signup endpoint" when X lives on a row that a downstream onboarding step creates.
Rule: If `/host` redirects to onboarding ONLY when no hosts row exists, don't create the row in the auth endpoint — let onboarding-complete stay the single writer and stamp X there.
Reason: Creating the hosts row in `/api/auth/host-access` would make new hosts skip `/host/onboarding` entirely (`app/host/page.tsx:51` gates on row presence), breaking the goal.

### new-column-breaks-point-at-prod-dev
Trigger: Verifying an undeployed feature whose migration adds a NEW column, via the usual "point local dev at prod Supabase" trick.
Rule: That trick fails here — the column doesn't exist in prod until the migration deploys. Need a local stack or apply the migration first; otherwise verify post-deploy.
Reason: This worktree had no Docker/supabase-CLI/real .env and prod lacked `trial_ends_at`, so end-to-end couldn't run pre-merge; honestly deferred to deploy instead of false-claiming.

### merge-is-not-migrated
Trigger: A merged/deployed PR includes a new `supabase/migrations/NNNN_*.sql` that adds schema (column/table).
Rule: Deploying code does NOT apply the migration. Apply it separately (Supabase MCP `apply_migration` / `db push`) and confirm the column exists before declaring the feature live.
Reason: PR #88 shipped to prod but `trial_ends_at` was never applied — new-host onboarding-complete 500'd in production until the migration was applied by hand post-merge.

### audit-subagents-read-the-working-tree
Trigger: Dispatching read-only audit/review subagents at a file a recently-merged PR changed.
Rule: Subagents read the current working tree. On a branch predating the merge, their findings describe the OLD code — verify branch state or run them off updated main first.
Reason: Three audit agents flagged questions/[id]/route.ts as buggy, but this worktree predated #99; the bug was already fixed on main and proven on prod.

### realtime-zombie-after-sleep
Trigger: Host/player screen frozen on a stale view; F5 doesn't fix it; fully quitting the browser does.
Rule: Chrome's WebSocket can zombie (connected but silent) after laptop sleep. Our 3 safety nets trust socket status, not data freshness. Add a "received-anything-recently?" watchdog.
Reason: Heather's go-live lost a whole section to a 215s host freeze; refresh keeps Chrome's broken socket pool, only full quit clears it.

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

### write-to-worktree-not-main-repo
Trigger: Working in a git worktree under `.claude/worktrees/<name>/` and creating files with Write/Edit using absolute paths.
Rule: Always root absolute paths at the worktree dir, not the repo root. `ls`/vitest run from the worktree cwd; a file Written to `/…/tr1via/tests/…` won't be seen there — it landed in the MAIN repo.
Reason: The scope-guard test + design docs went to the main repo; vitest (in the worktree) found "no test files." Caught it, relocated everything, but it cost a recovery loop.

### squashed-main-vs-unsquashed-branch-needs-clean-replay
Trigger: Opening a PR from a local branch whose recent commits are unsquashed siblings of work already squash-merged to `origin/main` (identical trees, different SHAs).
Rule: Don't PR the branch directly — its diff vs main includes the divergent history. Replay only the new commits onto `origin/main` (fresh branch + checkout the new files as one commit). A file-watcher/linter that dirties the tree between cherry-picks will abort them; apply the whole diff in one atomic add+commit instead.
Reason: `git diff main...head` walked back to an ancient merge-base; cherry-pick kept failing as a linter re-touched files mid-replay. One atomic commit off origin/main gave a clean 18-file PR.

### marketing-scope-guard-tag-blocks-backend-work
Trigger: Doing any `app/api`/`lib`/`app/host` change after the marketing pass merged, and `tests/unit/marketing/seo-and-scope.test.ts` fails on "PROTECTED runtime files."
Rule: That guard diffs against a local-only `marketing-base` git tag (unpushed → CI unaffected). The tag's job ended when the pass merged; delete it (`git tag -d marketing-base`, was 90686c8) so local matches CI. Committing your changes also clears it (baseline falls back to HEAD).
Reason: The merged guard keys off a fixed tag, so it red-flags ALL later backend work locally though it's a no-op in CI; cost a diagnosis loop before the paywall build could verify.
UPDATE (host-mobile pass): the scope-guard `describe` was RETIRED — its job ended at merge and it blocked sanctioned host edits. Only the SEO checks remain in that file. No tag to delete now.

### rls-is-column-blind-revoke-the-column
Trigger: Hiding ONE secret column (e.g. answer) from a role while the row itself must stay readable (live question still needs prompt/options).
Rule: RLS is row-level only. Use column privileges: `revoke select on T from <role>` then `grant select (every col EXCEPT secret) on T to <role>`. Postgres can't subtract one column from a relation-wide grant.
Reason: questions_player_read gated on played_at exposed correct_index to any anon player; the only column-level lock is the explicit re-grant (migration 0014, players=anon, host=authenticated keeps it).

### revoke-migration-deploy-client-before-migrate
Trigger: A migration REMOVES a privilege/column the currently-deployed client still reads (the reverse of an additive migration).
Rule: Deploy the new client FIRST, then apply the migration. Applying first makes the old client's `select('*')`/secret-column reads 401. (merge→Vercel deploys, then apply by hand — natural order is safe; never apply before the deploy lands.)
Reason: 0014 revokes anon's correct_index; the old player client's `readLastResolved select('*')` 401s once it lands (degrades to the admin route, but deploy-first avoids it entirely). Inverts [[merge-is-not-migrated]]'s usual flow.

### verdict-ui-must-hold-when-both-signals-absent
Trigger: A right/wrong (binary) reveal computes from a client field OR'd with a server echo (see trust-client-data-over-async-echo) and a change can make BOTH momentarily absent.
Rule: When neither signal is present yet, render a neutral holding frame — never a definitive verdict. `chosen === undefined` is false, so a correct player flashes "WRONG" with a blank answer.
Reason: Migration 0014 stripped correct_index from the player row, reintroducing a window where correct_index AND is_correct are both unset on fresh-join; RevealView now guards on `typeof correct_index !== "number"`.

### host-screens-inline-styles-need-usemediaquery-not-media-queries
Trigger: Making a host-laptop screen (login, onboarding, dashboards, LaptopShell) responsive for mobile.
Rule: These screens are pure inline styles — CSS media queries can't reach them. Gate layout props on `useMediaQuery(...)` from `@/components/system/useMediaQuery` (defaults false→desktop on SSR). Keep the desktop branch's literal values so desktop stays byte-identical (verify via before/after 1280px screenshot SHA match).
Reason: Host flow was laptop-only; on phones the fixed grids (`240px 1fr`, `1fr 1fr`) clipped sign-in + dashboard off-screen. Desktop-default SSR + per-prop compact branch fixed mobile with zero desktop drift (4/4 desktop SHAs identical).

### research-the-remote-not-the-local-branch
Trigger: Dispatching researchers (or reading code) to scope a feature/bug while the local working tree is a long-lived scratch branch.
Rule: Point research at `origin/main` (fetch + a worktree off it), not the working checkout — a stale branch hides shipped features and inverts the plan.
Reason: Researchers read the stale `june-reactive-water` tree and missed the trial+entitlement foundation already on main; the Stripe brief's "greenfield" premise was false until a worktree off origin/main surfaced it.
UPDATE (live-incident analysis): before treating code reads as "what players saw," confirm the live PROD deployment SHA == local HEAD (`vercel inspect tr1via.com` → created time matches the commit). Local-clean ≠ prod-current.

### dba-is-not-a-separate-legal-entity
Trigger: Setting the legal party on a Stripe account, Terms of Service, or any contract when the business operates under a DBA / assumed name (e.g. "Vyntechs").
Rule: A DBA is a trade name, not an entity. The legal party is the individual (or LLC) **doing business as** that name — use the person's legal name + the trade name, not the DBA alone.
Reason: Brandon's "Vyntechs" is a Texas DBA, so the ToS names him as a sole proprietor d/b/a Vyntechs and Stripe activation needs his legal name — getting this wrong misstates who is liable.

### dnd-kit-ssr-needs-stable-context-id
Trigger: Rendering `@dnd-kit` `DndContext` inside a `"use client"` component that still server-renders (e.g. the host pick screen) on its first paint.
Rule: Pass a fixed `id` to `DndContext` (`id="pick-board-reorder"`). Without it, dnd-kit's `aria-describedby` ("DndDescribedBy-N") counter differs server vs client → React hydration mismatch warning.
Reason: Caught only by a real-browser console check (jsdom + HTTP 200 both stayed silent); the live Playwright drag surfaced `DndDescribedBy-0` vs `-2`, and the stable id made both deterministic.

### reorder-pointvalue-clear-first-not-swap
Trigger: Writing a multi-row reassignment of `questions.point_value` (board reorder) given the `unique(category_id, point_value) deferrable initially deferred` index.
Rule: supabase-js auto-commits each `.update()`, so "deferrable" doesn't save you — a transient A→200 while B holds 200 still trips. NULL every target value first (NULLs are exempt), THEN set each. Mirror `lib/host/pickQuestions.ts`.
Reason: A naive per-row swap 500s on the unique index; clear-first is the established codebase idiom and needs no migration (reuses point_value, dodging this project's apply-on-deploy footgun).

### jitter-the-initial-fallback-not-just-the-poll
Trigger: Adding a server-route fallback for a whole room (many clients) that polls on a jittered cadence when realtime degrades.
Rule: Jitter the FIRST fallback fetch too, not only the subsequent polls. A room's direct reads all fail at the SAME deterministic timeout, so every client's initial route fetch fires in the same instant — a Supabase read-fan-out spike — even though the polls are spread.
Reason: Load test (N=8) put all 8 initial `/api/room` fetches in one 500ms bin (≈72 admin reads burst); a per-client random pre-delay (≤2.5s) spread them to maxBin=3. The poll jitter alone didn't cover the entry stampede.

### route-survives-venue-block-direct-reads-dont
Trigger: A venue network where the live game breaks but the site + TV still load.
Rule: Only the live game does DIRECT browser→Supabase reads; a server route (browser→Vercel→Supabase) survives the block because Vercel→Supabase is server-to-server. Route the live game's reads through Vercel (like /tv) to keep it working; don't assume "switch networks" is the only fix.
Reason: On 06-10 marketing + TV worked, only the live game went black — proof the Vercel→Supabase leg was fine and a route fallback keeps the game live (Phase 2). See [[reachability-keys-off-supa-reads-not-by-code]].

### reachability-keys-off-supa-reads-not-by-code
Trigger: Detecting "can't reach the server" on the host/player room surfaces (venue WiFi blocking Supabase).
Rule: Key the unreachable signal off the DIRECT `supa.from(...)` read outcome, NOT the `/api/nights/by-code` response. By-code is same-origin (Vercel reads Supabase server-side) so it survives the block; only the browser's direct reads fail.
Reason: The black host screen came from null `night` after the direct reads failed while by-code still returned 200. e2e must block `*.supabase.co` AND seed a real open night — the block doesn't touch the server route.

### stale-view-fix-needs-a-real-local-signal
Trigger: A "player stuck on a stale view" brief that says to OR a slow server field with "data already on hand."
Rule: First confirm a fast LOCAL signal exists (and the broadcast-tag union carries it) and that the 15s heartbeat already self-heals — before adding an optimistic flip.
Reason: The proposed game-ended OR was dead code (game-ended not in BroadcastTag union; handler never stamped lastBroadcast); the heartbeat self-heals. Real gap: the category preview.

### one-session-owns-a-linear-task-parallelism-is-internal
Trigger: Offering to "independently review" or otherwise running a linear task (validate→review→merge) across two separate Claude sessions Brandon drives.
Rule: Don't. One session owns a linear task end-to-end; do fan-out via internal subagents/Workflow that report to me. Reserve separate sessions for genuinely INDEPENDENT tracks.
Reason: Two sessions on one task forced Brandon to hand-carry the validator's summary into the reviewer and relay the go/no-go back — painful, inefficient courier work I created. Subagents report to me, never to his clipboard.

### fetch-doesnt-throw-on-http-error-catch-only-fallback-misses-it
Trigger: Wrapping a `fetch()` in a resilient retry/route-fallback but wiring that fallback only inside the `catch` block.
Rule: `fetch` rejects ONLY on transport failure/timeout, never on an HTTP non-2xx — a server-answered 4xx/5xx skips a catch-only fallback and lands in the `!res.ok` branch with no retry. Handle both.
Reason: `useRoom`'s by-code `tryRouteFallback` is catch-only, so a transient route 5xx on bad WiFi still hard-renders "room isn't open" — the still-open join-path fast-follow surfaced during the PR #103 review.

### logged-lesson-is-not-a-shipped-fix
Trigger: A bug pattern already documented in tasks/lessons.md (a past diagnosis), assumed to be fixed.
Rule: A logged lesson records that something was UNDERSTOOD, not that the fix shipped. Verify the fix exists in code/migrations before trusting it; periodically re-audit the actual artifact.
Reason: `view-leftjoin-filter-trap` was diagnosed and lessoned, but `game_scores` (0001_init.sql) was never redefined — the CRITICAL 2-game score double-count is still live in prod (foundation audit 2026-06-13).
UPDATE (2026-06-14): the inverse also bit — this Reason is itself WRONG. The audit read the repo file (`0001_init.sql`), but LIVE prod was already fixed on 5/28 (`fix_game_scores_view_per_game_filter`); the double-count is NOT live in prod. See [[verify-live-prod-catalog-not-repo-or-handoff]].

### e2e-assert-values-not-just-visibility-for-correctness
Trigger: Writing or relying on an e2e covering a correctness-critical path (scores, winners, money, counts).
Rule: Assert the actual VALUE (name/number), not just that the element rendered. "Winner card is visible" passes even when the winner and score are wrong.
Reason: `tests/e2e/full-game.spec.ts` plays game1→game2→finale but only checks the winner card is visible, so the `game_scores` double-count passed CI undetected.

### test-sql-views-on-pglite-not-mocked-client
Trigger: Needing to test a Postgres view / SQL aggregate (e.g. `game_scores`) the mocked supabase-js client can't exercise, with no Docker/CLI available.
Rule: Use `@electric-sql/pglite` (real Postgres in WASM, devDep). Stub `auth.users` + `extensions` schema, apply the actual migration files, seed, assert. Runs in normal `npm test`/CI.
Reason: The `game_scores` double-count shipped because mocked unit tests can't run a view; pglite gave a deterministic RED→GREEN proof in-process — no cloud branch or Docker (PR #105).

### comment-string-concat-breaks-migration-replay
Trigger: A Supabase preview branch (or any from-scratch migration replay) comes up MIGRATIONS_FAILED with 0 applied, though prod has them.
Rule: `COMMENT ON ... IS 'a' || 'b'` is invalid SQL (COMMENT needs ONE literal). Branch replay runs all files in one transaction, so one such line rolls back EVERYTHING. Collapse concatenated comments to single literals.
Reason: tr1via 0006/0010 used `||` in COMMENT; the branch auto-migrate applied nothing. Prod was fine (already applied); only clean replays (new branch / DR rebuild) break. Found during #106 validation.

### prove-server-db-target-before-destructive-test
Trigger: A local dev server points at a throwaway DB and you're about to seed/reset; must confirm it isn't accidentally prod.
Rule: Don't trust the ".env.local" boot log (sourced env still wins) or `ps` (macOS hides env). Plant a unique marker row on the intended DB via the admin/MCP connection, then read it through the server's OWN route — not-found means wrong DB, abort.
Reason: #106 browser validation — confirmed the dev server read the branch not prod by renaming a branch-only night to a valid room code and reading it via /api/tv/[code]/snapshot before any seed/reset.

### sb-secret-key-authenticates-as-service-role
Trigger: You need a branch/project service-role credential but the Supabase MCP only returns anon/publishable keys.
Rule: A modern `sb_secret_…` key authenticates as `service_role` over PostgREST (apikey + Bearer) and supabase-js forwards it verbatim, so the app's admin client accepts it. Grab it from the dashboard's API Keys page.
Reason: #106 browser validation needed the branch's service-role key the MCP can't expose; the dashboard `sb_secret_` key read correct_index + the RLS-protected hosts table and ran the full app.

### verify-live-prod-catalog-not-repo-or-handoff
Trigger: A handoff/audit says a prod bug "is still live" or a migration "is NOT yet applied," based on reading a repo migration FILE.
Rule: Read prod's LIVE catalog before believing it — `pg_get_viewdef`, `information_schema` grants, `list_migrations`. Repo↔prod migration NAMES drift (repo `00NN_*` vs prod timestamps), so "not in repo history" ≠ "not applied."
Reason: Handoff said "prod still double-counts, 0013 unapplied"; live prod already had `fix_game_scores_view_per_game_filter` (5/28) closing it. The 6/13 audit read repo `0001_init.sql`, never prod — nearly applied a redundant migration.

### where-form-game-filter-drops-cross-game-joiner
Trigger: Fixing a per-game aggregate view with `WHERE c.game_id = gp.game_id OR a.id IS NULL` (the [[view-leftjoin-filter-trap]] "move to WHERE" remedy).
Rule: That OR only rescues players who answered NOWHERE. A two-game player who answered in the OTHER game has non-null answer rows, so no null row exists and they VANISH from this game's board. Use aggregate FILTER (repo 0013) to keep every participation row at 0.
Reason: Proven on real prod via synthetic-CTE A/B + 8 real participation rows that disappear. The WHERE remedy fixed the double-count but introduced this edge; FILTER fixes both.

### player-per-game-total-from-broadcast-answers-not-scores-sub
Trigger: Showing a per-game running total (or similar live number) on a PLAYER phone reveal screen.
Rule: Derive it from the broadcast-refreshed `myAnswers` (filtered to the current game via a question→game map), NOT the `game_scores` subscription — postgres_changes drops for device-cookie sessions, so the scores sub can sit stale.
Reason: PR #108 #2 — summing all `myAnswers` double-counted across games; `game_scores` was correct but its phone subscription is unreliable, so the broadcast-triggered `myAnswers` is the fresh source. Same root cause as [[trust-client-data-over-async-echo]].

### branch-off-main-in-place-aborts-on-tracked-untracked-collision
Trigger: `git checkout -b new origin/main` in the main repo when untracked local files exist that are TRACKED on origin/main (e.g. a report committed on main but only local-untracked on the scratch branch).
Rule: The checkout aborts ("move or remove them"). Don't fight it with stashes — use a worktree off origin/main (symlink `node_modules` + `.env.local` to the main repo, per the project's existing worktree pattern). Run vitest from the worktree cwd.
Reason: PR #108 — stashing the 3 tracked docs still aborted on untracked `tasks/*-report.md` that exist tracked on main; a worktree sidesteps the collision entirely and keeps the main tree untouched.

### live-e2e-blocked-by-edge-runtime-fetch-in-this-env
Trigger: Running Playwright e2e (`npm run test:e2e`) here to validate against live prod Supabase; every test dies at the first `/api/_test/*` call with `loginAsHost failed: 500 {"error":"fetch failed"}`.
Rule: Not a fix bug and not a network block — it's the Next EDGE-runtime middleware (`server/web/sandbox/context.js`) failing to fetch Supabase auth under local Turbopack dev. Confirm with curl (Supabase host → 401, neutral host → 200 = egress fine), then DON'T chase it; lean on vitest+PGlite + wiring audit + adversarial fan-out. The same middleware serves Heather's live shows on Vercel.
Reason: PR #108 validation — burned a run discovering localhost e2e can't reach Supabase from the edge isolate here; prod was untouched (login fails before any seed).

### reveal-points-testid-is-per-question-not-running-total
Trigger: Writing an e2e to assert the player reveal RUNNING TOTAL (the per-game cumulative score, e.g. for #2).
Rule: `player-reveal-points` (`PlayerRevealCorrect.tsx`) is the THIS-QUESTION number (`+{awardedPoints}`). The cumulative `totalScore` is a separate element with NO testid (the "NOW AT" footer); `PlayerRevealWrong` shows the total with no testid at all. Add a `player-reveal-total` testid before asserting it.
Reason: PR #108 #2 — the per-game total bug was invisible to `full-game.spec.ts` (drives the 2-game arc but never asserts the phone total) precisely because the value the fix changes isn't selectable. [[e2e-target-testid-not-visible-copy]]

### sync-beat-schedule-against-target-not-fire-on-mount
Trigger: Adding a "catch-up" so a freshly-mounted component still plays a synchronized one-shot beat (firework/flash) it may have missed.
Rule: Don't fire on mount — schedule against the shared target instant + de-dup by beat id. Mount-firing ignores the target and double-fires across per-view remounts.
Reason: Each TV view mounts its OWN Pyrotechnics engine, so the resolve that triggers the beat also remounts it; my mount catch-up fired on the outgoing screen at fireAt, then replayed late on the reveal engine — a double-burst, out of step (July Phase 2; adversarial review caught it).

### gate-cosmetic-beat-bind-to-its-own-id
Trigger: Gating a per-X cosmetic beat (firework/flash) on derived state (e.g. "did I get it right") that arrives via a DIFFERENT async path than the beat.
Rule: Bind the beat to X's id and gate only on a match. The derived state lags the synchronous beat by one X until the refetch lands.
Reason: July salvo gated on `amCorrect`, which reflected the PRIOR question until refreshLiveState landed — could fire a salvo on a wrong answer (or miss a correct one) in the race window (Phase 3; adversarial review caught it).

### opting-into-a-shared-registry-flag-flips-every-consumer-on-every-surface
Trigger: Registering a theme into a shared config registry to enable ONE treatment (e.g. adding `july: { ceremony: "fireworks" }` to lockInCeremony to get the TV marquee + TV firework ceremony).
Rule: A registry flag is read by EVERY consumer of that flag across ALL surfaces. Before flipping it, grep every reader (`hasCeremony`, `hasMarquee`, `lockInCeremonyFor(...).ceremony`) on phone AND tv AND host — a generic gate elsewhere will silently inherit the new behavior. Gate surface-specific visuals on the SPECIFIC value, not the generic "has X" predicate.
Reason: July Phase 4 — enabling `hasCeremony("july")` made the player phone's `PlayerLockInBolt` (a LIGHTNING bolt, gated on generic `hasCeremony`) fire on July phones — lightning on the 4th. Fix: gate the bolt on `ceremony === "lightning"`. Caught by adversarial review, NOT by the grounding subagents (two of them wrongly claimed "phones show no ceremony" — verify subagent claims against real code). [[gate-cosmetic-beat-bind-to-its-own-id]]

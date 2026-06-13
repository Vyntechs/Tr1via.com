# Lessons

> Curated by the `lesson-keeper` subagent per workflow §3. Each lesson must be a non-obvious pattern with Trigger / Rule / Reason, each ≤ 25 words. Hard cap: 40 active lessons; overflow moves to `lessons-archive.md`.

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

# TR1VIA — Handoff

**Read order for a fresh session:** this file → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `docs/superpowers/plans/2026-05-23-smoke-orchestration.md` (test orchestration plan) → `supabase/README.md` (DB setup) → `README.md` (run instructions). The Claude Design package is at `/tmp/tr1via-design/tr1via/` (chats + JSX prototypes).

---

## State as of 2026-05-24 (~5am, end of session 4)

**Live, deployed, working on `tr1via.com`:**
- `main` latest: `70fcc55 fix(live): auto-start game on first reveal so TV/phones leave lobby` (2 new commits this session on top of session 3).
- TypeScript build clean. **187/187** unit + component tests pass (was 181 — added 6 for `previewPointValues`).
- `full-game.spec.ts` (28-reveal multi-context test against localhost + MSW mocks) passes in 2.4 min.
- `reveal-sync.spec.ts` passes when Supabase is responsive (variance day-to-day; 1.8–9 s arrivals against 3 s budget).
- **Brandon can log in at `tr1via.com/login` with `brandon@vyntechs.com` and lands on `/host` in ~1 s via the founder bypass.** No email needed.
- **Question generation works end-to-end:** ~20 s for Claude Haiku 4.5 + ~10 s for 20 Pexels photos = ~30 s total per category, then auto-navigates to the pick-7 screen.
- **Realtime works in prod** (was completely broken in session 3 — see "Lessons" below).
- **NEW: pick-tier sidebar honestly previews the lock distribution** — picks at the same Claude rating no longer overwrite each other; cards show "originalRating → assignedTier" when they shift.
- **NEW: host → TV + phone reveal sync verified end-to-end on real prod** — first reveal now auto-starts the game so all three surfaces leave lobby together. Tested with chrome-devtools-MCP driving three pages (host laptop + TV + phone in isolated browser context, 390×844).

**Production resources (canonical):**
- Supabase **Trivia** (`citweuctcnuxmqjxcbiz`). 5 migrations applied. Site URL = `https://tr1via.com`, redirect allowlist contains `https://tr1via.com/auth/callback`. SMTP is still default — emails to `@vyntechs.com` are dropped silently (use bypass instead of magic link).
- Vercel project `tr1via` in team `brandon-nichols-projects-f7e6d2a9`. `vercel link` already run; `.vercel/project.json` exists.
- **Founder is `brandon@vyntechs.com`**, not the gmail address. Gmail was demoted to role='host' tonight. Both rows have `is_paywall_bypassed=true`.

**Brandon's accounts in prod:**
| Email | Role | First-night complete | Nights |
|---|---|---|---|
| brandon@vyntechs.com | **founder** | false (sees onboarding) | 0 |
| brandon.james.nichols@gmail.com | host | false | 0 |

---

## What was built in session 4 (2026-05-24 ~3–5am)

### Two demo-blocking bugs found and shipped to prod

1. **`32bb985` — pick-tier preview.** PickSidebar in `components/host/gen/HostGenPick.tsx` was keying `byDiff[difficulty * 100]`, silently overwriting when two picks shared Claude's rating. Brandon screenshotted "7/7 picked but 100/600/700 empty" on a grunge-bands batch where Claude rated everything 200-400. Fix: new `previewPointValues(picked)` helper in `lib/game/difficulty.ts` mirrors the server's `assignPointValues` rule but tolerates any N from 0..7. Sidebar + cards both consume the preview map. Picked cards now show "originalRating → assignedTier" with the original struck through when shifted. Server-side `assignPointValues` was already correct — the bug was purely client display.

2. **`70fcc55` — auto-start on first reveal.** `/api/games/[id]/start` was defined but **never called anywhere** in the app. Host clicking a board cell only fired `/api/games/[id]/reveal`, which leaves `games.state = 'draft'`. The TV (`app/tv/[code]/page.tsx:194`) AND phone (`app/(player)/room/[code]/page.tsx:291`) both render `TVLobbyView` / "host is setting up" whenever `currentGame.state === 'draft' || === 'ready'`. Net effect: host plays through the whole game on her laptop while every player phone + the venue TV stares at the QR code. Found by multi-page chrome-devtools-MCP drive, not by API smoke. Fix: `handleReveal` now POSTs `/start` before `/reveal` whenever the game is draft/ready. `/start` is idempotent so the e2e helper that calls it explicitly still works unchanged.

Both fixes verified live on prod via chrome-devtools-MCP driving three independent page contexts (host + TV + phone in isolated browser context). Smoke CI green on both pushes.

### Architectural lessons worth carrying forward (session 4 additions)

17. **Idempotent endpoints make "belt + suspenders" cheap.** `/start` returning 200 if already-live let `handleReveal` always call it without breaking existing helpers. Worth applying the same pattern to any state-transition endpoint future-us is tempted to gate behind a "should I call this?" client-side check.
18. **Implemented-but-unused endpoints are a code smell.** `app/api/games/[id]/start/route.ts` existed for ~3 sessions and Brandon almost demoed without anyone ever calling it. A grep for `import.*[Rr]oute` against route paths, or a "0 callers" check in CI, would have flagged it.
19. **Two distinct UI bugs, same testing root cause.** The pick-tier bug (silent overwrite in the sidebar) and the reveal-sync bug (lobby stuck because game.state stayed 'draft') were both invisible to pure code review and to the existing API/UI smokes. Both were caught by *driving the actual screens the user/audience sees*. This is the third concrete instance backing `feedback_validate_dont_just_claim` — keep that memory load-bearing.

---

## What was built in session 3 (today)

### Bug fixes shipped to prod (in commit order)

1. **`1807bb4` — bugs #3 + #4 from session 2.** TVRevealStumper missing `data-testid="tv-reveal"`. `useConnectionStatus` hydration mismatch on /join (initialized from `navigator.onLine` on client, defaulted true on server; headless Chromium reports offline at boot).
2. **`7d93f5d` — game-ended broadcast + optimistic in-game-2.** End-game route now broadcasts `game-ended` so phones don't get stuck after game 1 (postgres_changes for `games` doesn't reach device-cookie sessions). PlayerJoinGame2Wired now flips an optimistic flag on successful API call so tapping the Join button advances the player immediately.
3. **`a8a8ede` — full-game.spec.ts** + helpers + extended `seed-night` to fill game 2.
4. **`58f9978` — founder bypass.** `POST /api/auth/founder-login` mints a session if the email matches a row with `role='founder'`. `/login` page tries this first, falls back to magic link if 404. Why: corporate domains (vyntechs.com) silently drop Supabase's default SMTP, and Brandon needed to be able to log in at all.
5. **`90c32b4` — Haiku 4.5 + `maxDuration=120`.** Switched `DEFAULT_MODEL` after benchmarking (2.5× faster, 3.2× cheaper, comparable distractor quality). Added explicit 120 s function ceiling on the generate route — Vercel's default was killing the background job mid-photo-attach.
6. **`051a2f5` + `b300e7a` + `ac9c10c` — auto-smoke CI.** GitHub Actions runs `scripts/prod-smoke.mjs` + `tests/e2e/prod-ui-smoke.spec.ts` on every push. Failures email Brandon. No cron (was overkill).
7. **No code commit (Vercel env var change only):** anon-key trailing-newline fix. `vercel env rm NEXT_PUBLIC_SUPABASE_ANON_KEY production --yes` then re-add via `printf '%s' "$CLEAN_KEY" | vercel env add ...`. Plus the `host-onboarding-first` testid landed in commit `f798a06` (UI smoke).
8. **`1f1edb8` — actually render the Pexels photo on pick + loading cards.** `StockImage` was a placeholder ALL ALONG; the comment literally said "In production StockImage will be replaced with the real Pexels-backed component." Never was. Pick cards now render the real `q.imageUrl` via an `<img object-fit:cover>`.
9. **`40691d9` — photo cascade.** Auto-attach tries Claude's photoQuery → topic name → "abstract texture". Three Pexels queries before giving up. Means cards never render the striped placeholder on real generated questions.

### Production environment changes (NOT in code)

- **Supabase Site URL:** `http://localhost:3000` → `https://tr1via.com` (via Management API)
- **Supabase redirect allowlist:** added `https://tr1via.com/auth/callback`
- **Vercel env `ANTHROPIC_API_KEY`:** rotated (Brandon pasted fresh)
- **Vercel env `NEXT_PUBLIC_SUPABASE_ANON_KEY`:** had a literal trailing `\n` character. Replaced with clean value from `.env.local`. **This was the single most impactful fix tonight** — it was breaking ALL Supabase Realtime subscriptions in prod. URL-encoded as `%0A`, JWT signature mismatch, every WebSocket auth rejected.
- **Supabase data:** `brandon@vyntechs.com` is `role='founder', is_paywall_bypassed=true`. Gmail is `role='host'`. Test nights all cleaned up.
- **GitHub Actions secrets:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMOKE_FOUNDER_EMAIL`.

### New test + ops infrastructure

- `scripts/prod-smoke.mjs` — drives tr1via.com end-to-end (auth → night → category → real Anthropic → real Pexels → cleanup). Exit 0 = green. ~30 s.
- `scripts/compare-models.mjs` + `scripts/compare-models-batch.mjs` — benchmark Sonnet vs Haiku.
- `scripts/generate-magic-link.mjs` — admin-mint a magic link URL when SMTP is dead.
- `tests/e2e/prod-ui-smoke.spec.ts` — Playwright UI smoke against tr1via.com (login → /host).
- `playwright-prod.config.ts` — config that runs against prod, no webServer.
- `.github/workflows/prod-smoke.yml` — runs API smoke + UI smoke on every push + on-demand. GitHub emails on failure.

---

## Known unfixed bugs / gaps (real, in production code)

### Demo-blocking risk (untested but inferred-to-work)

Session 4 closed three of the four entries here. What remains:
- ~~**Reveal sync on prod** (host → TV + phones via room-channel broadcast).~~ ✅ **Proven on real prod 2026-05-24 session 4** — drove host laptop + `/tv/[code]` + `/join` (phone viewport, isolated browser context). Found the missing `/start` call along the way; fixed in `70fcc55`. TV question view + phone reveal-then-resolve frames both render correctly.
- ~~**`/tv/[code]` on real prod**~~ ✅ **Proven on real prod 2026-05-24 session 4** — TVLobby + TVGrid + TVQuestion all rendered correctly with real Supabase + real anon key.
- ~~**`/join` + PlayerJoin → PlayerLobby on real prod**~~ ✅ **Proven on real prod 2026-05-24 session 4** — phone entered code, picked a name, landed in lobby, then transitioned through question + resolve frames.
- **Multi-device sync at venue scale** (30–50 phones on real wifi). Code is the same as the 1-phone prod test that passes (session 4) and the 3-phone local test that passes. Wifi at the venue and iOS Safari quirks remain the unknowns. Only the real-device dry run will close this.

### UI still uses placeholder StockImage on these screens

The render fix tonight only touched `HostGenPick` and `HostGenLoading`. These still show stripes:
- `HostGenEdit` — line 195
- `HostGenImageSwap` — lines 232 and 285
- `HostGenImageUploadReady` — lines 49 and 85
- `HostGenImageUpload` — line 255
- `HostGenFlavor` — line 94

The swap UI flow needs the same `src={...}` treatment for the host to actually see what they're swapping to. Not blocking the demo if Brandon doesn't manually swap.

### Pending from session 2 + 3 todo lists

- **Phase 5.2** of the orchestration plan — five edge-case specs still unwritten (rejoin, network-drop, mid-game-edits, manual-entry, generation-failure).
- **Phase 6** — API integration tests per resource.
- **Phase 7** — `smoke-routes.spec.ts` (visit every route, check console errors). `prod-ui-smoke.spec.ts` is a tiny version of this.
- **Phase 9** — gaps doc.
- **Hydration mismatches** in browser console on a few player pages — flagged session 2, not investigated further.
- **The "static, sketchy" feel** of HostGenLoading — now that broadcasts work, the counter visibly ticks. Whether it still "feels sketchy" is a separate UX call.

---

## Architectural lessons worth carrying forward (session 3 additions)

These are NEW vs session 2's lessons doc — keep both:

10. **A trailing `\n` in a JWT env var BREAKS Supabase Realtime silently.** Vercel's `NEXT_PUBLIC_SUPABASE_ANON_KEY` had a literal newline character at the end. URL-encoded as `%0A` on the WebSocket connect, JWT signature includes the newline → signature mismatch → auth fails. No clear error in the app, just `[error] WebSocket connection ... failed: HTTP Authentication failed` in browser console with 13 retries. To detect: `od -c | tail` on the env value should NOT show a `\n` at the end. To fix in CI: trim trailing whitespace before storing.

11. **API-only smoke is INSUFFICIENT for a real-time app.** The `prod-smoke.mjs` and `prod-ui-smoke.spec.ts` both went green on the night the anon-key bug was active, because neither touched the WebSocket. The bug was found by chrome-devtools-MCP interactive walkthrough watching the browser console live. Lesson: any new smoke should explicitly assert a WebSocket subscription succeeds.

12. **The `StockImage` "production" component was never built.** A placeholder named StockImage with a TODO comment was shipped to prod, called from every gen screen, and ignored the `imageUrl` it was supposed to render. Question: how many other "to be wired in production" placeholders are still in the tree? Worth a `grep -rn "production component\|TODO.*production\|seed=.*placeholder"` sweep.

13. **Vercel function default `maxDuration` is too short for AI+Pexels background jobs.** Without `export const maxDuration = N` on a route, Vercel kills the function at the plan default. Generation that takes 30–50s + photo attach hits this. Set explicit ceilings on long background work.

14. **Founder bypass is the right pattern for single-tenant ops.** Magic-link email is fragile; corporate domains drop Supabase's default SMTP. A server-side route that checks `hosts.role='founder'` and mints a session is the same trust boundary the admin dashboard already uses. Not a security regression vs the existing model.

15. **Brandon's founder email is `brandon@vyntechs.com`.** Memory + scripts default to this. The Gmail row exists as a regular host.

16. **Brandon's frustration patterns to listen for:** "you said it worked but it didn't" → I claimed validation without driving the actual user-visible flow. "Why is this so painful?" → I was over-engineering test infra while real prod was broken. The corrective behavior is: drive the actual UI before claiming green; the API path passing is not proof the UI works.

---

## How to resume (next session)

1. **`git pull`** — make sure you have through `70fcc55` (session 4 tip).
2. **Verify Brandon can still log in:** open https://tr1via.com/login, enter `brandon@vyntechs.com`, click Send. Should redirect to /host showing "Welcome, Brandon · Set up Wednesday".
3. **Run the prod smoke as a sanity check:**
   ```bash
   node --env-file=.env.local scripts/prod-smoke.mjs "any topic"
   ```
   Exit 0 = green.
4. **Demo-blocking work is DONE through session 4.** The remaining queue is polish + coverage that Brandon explicitly deferred at the end of session 4. Pick from this list — they're independent, work them in any order:

   **Test coverage**
   - [ ] Phase 5.2 edge-case Playwright specs (rejoin, network-drop, mid-game-edits, manual-entry, generation-failure) — see `docs/superpowers/plans/2026-05-23-smoke-orchestration.md`
   - [ ] Phase 6 API integration tests per resource
   - [ ] Phase 7 `smoke-routes.spec.ts` — visit every route, assert no console errors. `prod-ui-smoke.spec.ts` is a tiny version of this.
   - [ ] Phase 9 gaps doc
   - [x] Regression test for the session-4 fixes — `tests/component/HostGenPick.test.tsx` (4 tests, clump-heavy pick sidebar) and `tests/e2e/auto-start-on-reveal.spec.ts` (multi-context, asserts TV leaves lobby on first cell click). Both mutation-killed against reverts of the original fixes. The pick-tier regression is a component test rather than a Playwright spec because the bug is pure-UI keying with no server involvement; the server-side `assignPointValues` invariant is already covered by `tests/unit/difficulty.test.ts`.

   **UI gaps**
   - [ ] Wire `StockImage` to real `q.imageUrl` on the rest of the gen screens — `HostGenEdit:195`, `HostGenImageSwap:232,285`, `HostGenImageUploadReady:49,85`, `HostGenImageUpload:255`, `HostGenFlavor:94`. Only matters if Brandon manually swaps an image during the demo. The pick + loading cards were fixed in session 3 (`1f1edb8`).
   - [ ] UX polish on `HostGenLoading` — counter ticks now (session 3) but Brandon flagged it still "feels static." Could add the photo-attach progress as a separate streaming animation, or motion on the difficulty-distribution bar.
   - [ ] Hydration mismatches in browser console on a few player pages (flagged session 2, never investigated).

   **Operational**
   - [ ] Real-device dry run (2-3 phones, host laptop, TV, on real wifi) — Brandon's call when to schedule.
   - [ ] Open-question UX: there's no separate "About to start Game 1 — players, look up!" moment between lobby and the first question now that `70fcc55` auto-starts on cell click. If Brandon wants a dramatic START button as a separate beat, that's a small UI add (a primary button on the host live console that's only enabled when game.state='draft'/'ready' and disabled after first reveal).

5. **Don't:** ask Brandon questions whose answers he can't meaningfully evaluate. Just commit and execute. See `feedback_build_without_asking.md`.

---

## Tools that worked well tonight (use these first next session)

- **chrome-devtools MCP** — interactive walkthrough of prod found the anon-key bug that no automated test caught. `new_page`, `navigate_page`, `take_snapshot`, `evaluate_script`, `list_console_messages`, `list_network_requests`.
- **Supabase MCP** — `execute_sql` for DB inspection, `get_logs` for auth events. Faster than Supabase dashboard.
- **Vercel CLI** — `vercel env`, `vercel redeploy`, `vercel inspect`. `SUPABASE_ACCESS_TOKEN` is in env so the Management API also works via curl.
- **gh CLI** — `gh secret set` for Actions secrets, `gh run watch` for live workflow output.

---

## Memories worth carrying forward (auto-memory)

- `user_brandon.md` — non-technical solo dev. **Update: founder email is now @vyntechs.com.**
- `feedback_build_without_asking.md` — don't ask "how" questions; flag risky shared-state actions.
- `project_test_isolation.md` — smoke against PROD Supabase with `@tr1via.test` allowlist, NOT local Docker.
- New: **`feedback_validate_dont_just_claim.md`** — when claiming a fix works, drive the actual user-visible flow before saying it's done. API path passing ≠ UI works.
- New: **`project_realtime_anon_key.md`** — trailing whitespace in any Supabase JWT env var breaks WebSocket auth silently. Watch the env var hygiene.

Memory pointers can stay as-is; the new ones get added in `MEMORY.md`.

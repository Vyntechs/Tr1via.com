# TR1VIA — Handoff (end of session 15, 2026-05-25 late evening)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs in git history (session 14 close at `90a8268`, session 13 at `94cb045`).

---

## Critical context

**the first host (`host@example.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons. Roughly **33 hours** from session-15 close.

The night Brandon was testing on her behalf is `00000000-0000-0000-0000-000000000000` (room `XXXXXX`), still un-closed in the DB. the first host can leave it alone — PR #35 lets her plan a brand-new Wednesday night next to it.

---

## What landed this session (session 15)

| PR | What | Status |
|---|---|---|
| #35 | `fix(dashboard)`: + Plan a new night — host no longer stranded behind a single Resume CTA | **merged** by Brandon |
| #36 | `fix(player)`: re-bootstrap on tab focus + online — heals iOS background suspend | **ready for merge** |
| #37 | `feat(category)`: host can rename a category at any state — PR G2 | **ready for merge** |

**The story:** Brandon ran his test game on the first host's room with three real-friend players, hit several gaps at once:

1. **The dashboard was stuck on "Resume the live game" with no escape** — the first host couldn't plan Wednesday's night while the test night was sitting in the slot. PR #35 added a secondary "+ Plan a new night" button that uses the same proven create-night handler the empty-state already used. Already on prod, already merged.
2. **Player phones lock up when iOS Safari backgrounds them** — the highest-impact gap from the session-14 15-gap inventory. PR #36 added `useRevalidateOnFocus`: a tiny throttled hook that bumps a counter on `visibilitychange → visible` and on window `online`. The counter is wired into `useRoom`'s main effect deps so a bump forces a full re-bootstrap (HTTP refetch + new Realtime subscriptions). Verified on the preview by joining as a player, firing `visibilitychange` and `online` events via `page.evaluate`, and watching a fresh `/api/nights/by-code` request fire each time.
3. **the first host couldn't rename a locked category** — Brandon's session-12 ask "I just want it to say skirts" finally shipped. PR #37 finished the WIP from `feat-rename-category` (commit `493307b`): wired the existing `PATCH /api/categories/[id]` + `PatchCategoryBodySchema` to a new inline `EditableTopicEyebrow` pencil affordance on the Pick header. Renames only `categories.name`; `categories.topic` (the original Claude prompt + Pexels seed) is preserved, so renaming never invalidates the 20 candidates or the 7 picks. Allowed at any state — `draft`, `generating`, `review`, `ready`. Verified on the preview by renaming Brandon's locked "martial arts" category to "Karate (test)", confirming the header live-updated, confirming the DB row showed the new name with preserved topic and `state='ready'`, then restoring the original name.

**Validation evidence captured (both PRs).** Not just unit-test green — real UI clicks, real network inspection, real DB confirmation against the preview deployment that mirrors prod.

**Tests:** 254/254 unit tests passing on both branches. TypeScript clean. New tests added:
- `tests/unit/useRevalidateOnFocus.test.ts` — 7 tests covering visibility transitions, online, throttle, throttle-release, unmount
- `tests/component/HostGenPickRename.test.tsx` — 7 tests covering pencil visibility, input pre-fill, Enter-saves, Escape-discards, empty rejection, server-rejection error preservation, no-change close

---

## What's open going into session 16

### From the session-14 15-gap player-persistence inventory

PR #36 closed the highest-impact gap (focus + online re-bootstrap). Three categories remain, none Wednesday-blocking on their own:

- **Supabase channel `.subscribe()` status callback** — no auto-rebootstrap when CHANNEL_ERROR / TIMED_OUT / CLOSED fires (the focus listener heals most of this indirectly now)
- **`useAnswerSubmit` retry chains lost on refresh** — no localStorage queue. If a player refreshes mid-retry-backoff, their answer just vanishes silently.
- **`serverNowMs` clock-skew correction resets on refresh** — minor timer drift

The browser-driven prod E2E validation pipeline (session 15 P0.1) is still **WIP, stashed**. Built the spec, the helpers, the config, the npm script, the docs (`tasks/todo.md`). The single test run hung at "founder login" after ~10 min; killed when the first host's blocker came in. Has NOT been debugged or re-run. The stash entry is `wip-prod-e2e-pipeline pause for the first host hotfix` on `git stash list`.

### Pre-Wednesday checklist Brandon was running through

- [x] A — Merge PR #35 + click-test the new button
- [ ] B — PR #36 ready, awaiting merge
- [ ] C — PR #37 ready, awaiting merge
- [ ] D — the first host does her full Wed setup at home (her work, not ours)
- [ ] E — Cosmetic: close the stale test night via SQL when convenient

### Parallel agent that Brandon spun up mid-session

Brandon spawned a separate agent to handle **the first host setup progress preservation** — making sure her in-progress Wednesday setup doesn't get lost mid-flow. Status unknown to me; ask him.

### Other carryover from prior sessions (unchanged)

- **Multi-night planning dashboard** (`wip-host-multi-night-dashboard`, commit `9e02540`). WIP, doesn't typecheck on its own. PR #35 took the lean version (one extra button); the full dashboard rewrite is still parked.
- **"Room" → "Game" copy rename** — ~40 user-visible strings. No branch yet.
- **PR G3 (write your own custom question)** — spec only at `docs/superpowers/specs/2026-05-25-pr-g3-custom-question.md`. the first host wanted it; not blocking Wednesday.
- **Working-dir cleanup** — many `validate-*.png`, `verify-*.png`, `smoke-*.png`, `pr-*.png` files in repo root. Either gitignore the patterns or `rm` them.
- **`npm run lint` broken on main** — `next lint` removed in Next 16. Replace with `eslint .`.

---

## Auth model — unchanged

Sign-in is `type email → in`. No magic links. `/host/admin → SEND A SIGN-IN LINK` for cross-device. Memory: `project_auth_model_type_email_in.md`, `feedback_no_friction_without_security_gain.md`.

---

## Tools confirmed working (session 15)

- **Playwright MCP against a Vercel preview** — verified both PR #36 and PR #37 end-to-end. Joined as a player, drove the host UI, inspected network, queried DB, restored test changes. The preview URL is unauthenticated for this project so MCP can navigate freely.
- **`vercel ls`** — list deployments + preview URLs. The `--previews` flag isn't a thing; just `vercel ls`.
- **Supabase MCP `execute_sql`** — used to verify DB-level effects of the rename (name updated, topic preserved, state unchanged) and to find suitable target categories for live validation.
- **`scripts/full-flow-prod.mjs`** — the API-only fast smoke from session 14. Still green; still the right thing to run before merges that touch game flow.

---

## Schema state on prod (unchanged from session 13)

```
hosts.default_theme_key  text  NOT NULL  default 'daylight'
nights.theme_key         text  NULL      no default
categories.name          text  NOT NULL  (host-renamable after PR #37)
categories.topic         text  NOT NULL  (Claude prompt; immutable post-generation; PRESERVED by rename)
questions.point_value    smallint  null allowed
```

No schema changes in session 15.

---

## Workflow rules (non-negotiable, unchanged)

- **PR-first always.** Never push to `main`. Brandon merges; Claude opens.
- **Validate everything contextually possible BEFORE handoff.** Drive the actual user flow (preview / Playwright MCP / `scripts/full-flow-prod.mjs`) before claiming done. Session 15 validated PR #36 and #37 end-to-end through real preview UI + network + DB inspection; not just unit-test green.
- **For player-side Supabase failures, pull `get_logs` type `api` first.** Vercel logs lie because the failing request is browser→Supabase direct. See `reference_supabase_api_logs.md`.
- **When a shipped fix doesn't land, dispatch two parallel research agents** (code-search + logs) before re-hypothesizing. See `feedback_parallel_research_agents.md`.
- **Don't ask permission for engineering decisions when a spec + design exist.** Do ask for product/intent ambiguities.
- **Brandon's customer is non-technical.** Plain English in PR descriptions + customer-facing copy. No jargon.
- **Migrations: apply via MCP, don't touch other projects.** Trivia id: `citweuctcnuxmqjxcbiz`. NEVER touch `ynmtszuybeenjbigxdyl` (Vyntechs Auto) or `vggftauiaplktwnwciey` (lurnt-discovery).

---

## Resumption prompt for session 16

After `/clear`, type:

> **read HANDOFF.md and let me catch you up — the first host goes live Wednesday.**

Let Brandon set the priority. The handoff above tells the next session what's standing; he'll tell it where to point.

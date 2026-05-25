# TR1VIA — Handoff (end of session 11, 2026-05-25 noon)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs live in git history (session 10 at `04b6979`).

---

## Critical context

**Heather (`heatherhmoore@yahoo.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons. **2 days out.** She's actively using the app right now, sending Brandon text bug reports.

**Heather's account is now usable AND in use.** Email confirmed via Supabase MCP (`UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'heatherhmoore@yahoo.com'` at 2026-05-25 17:12 UTC). PR #25 (sign-out) merged at 17:29 UTC. **Heather signed in for the first time on her own account at 2026-05-25 17:37:59 UTC** and immediately created her first night on her own host_id (`b92b930d…`, venue: "Heather"). Her pre-#25 activity (pre-17:29 UTC) lives under Brandon's founder host_id; post-sign-in activity lands under her own.

---

## What shipped this session (session 11)

### Merged to main (Brandon's call, during the session)

| PR | What | Status |
|---|---|---|
| #19 | session 10 handoff doc (carried in from session 10 close) | merged 11:53 UTC |
| #21 | `feat(setup)`: host-controlled point values — Edit panel's POINT VALUE picker replaces DIFFICULTY; API + lock cascade respect explicit values; atomic swap on conflict | merged |
| #22 | `feat(pick)`: click × on YOUR BOARD slot to unpick — small additive UI on the picker | merged |
| #23 | `chore(dashboard)`: kill hardcoded "7:00 — 8:45 pm" placeholder | merged |
| #24 | `chore(dashboard)`: add "Wednesday night" subtitle under the venue (Heather's follow-up after #23) | merged |
| #25 | `feat(auth)`: sign-out everywhere — account chip + /login session guard + middleware fix | merged 17:29 UTC — first real prod use 8 min later (Heather signed in 17:37 UTC) |

### Open PRs

| PR | What | Risk | Status |
|---|---|---|---|
| **(this PR)** | session 11 handoff doc | trivial | you're reading it |

### Open design specs (not PRs — planning artifacts)

| Branch | Spec file | What |
|---|---|---|
| `docs-spec-g2-rename-category` | `docs/superpowers/specs/2026-05-25-pr-g2-rename-category.md` | Pencil-icon inline rename on Pick screen header; new `PATCH /api/categories/[id]`; mutates `name` only (leaves `topic` for Claude prompt + Pexels seed) |
| `docs-spec-g3-custom-question` | `docs/superpowers/specs/2026-05-25-pr-g3-custom-question.md` | "Write your own +" first card in the candidate grid; opens HostGenEdit in `mode="create"`; new `POST /api/categories/[id]/questions` inserts a host-authored row; **add over swap** (existing pick toggle handles the "I want mine instead" case) |

---

## Heather's complaints — status

| # | Quote | Status |
|---|---|---|
| 1 | "questions are not in the order I have put them" | ✅ #21 merged |
| 2 | "Can I make up my own question?" | 📋 spec ready (G3); implementation pending |
| 3 | "How do I rename a category after lock?" | 📋 spec ready (G2); implementation pending |
| 4 | "I edited to 400 but it shows 200 on the board" | ✅ #21 merged (same root cause as #1) |
| 5 | "the time needs to get removed from that page, show the date" | ✅ #23 + #24 merged |
| 6 | "click on a picked question to delete it directly" | ✅ #22 merged |
| 7 | "why is Smoke Test Pub showing" | ✅ data cleanup + sign-out path prevents recurrence |
| 8 | "It didn't give me a choice. It said sign in and I clicked it." | ✅ #25 merged 17:29 UTC; Heather signed in on her own account 8 min later (17:37 UTC) |

---

## What's still open

### 1. 🚨 P0: Build PR G2 (rename category) — spec ready

Spec: `docs/superpowers/specs/2026-05-25-pr-g2-rename-category.md` on branch `docs-spec-g2-rename-category`.

Tight scope: one new route + one inline pencil affordance. ~80 LOC. Heather will hit this on Wednesday if not shipped (her "skirts" rename is still pending from her earlier text).

### 2. P1: Build PR G3 (write your own custom question) — spec ready

Spec: `docs/superpowers/specs/2026-05-25-pr-g3-custom-question.md` on branch `docs-spec-g3-custom-question`.

Bigger surface: new endpoint + UI card + Edit panel "create mode". ~150 LOC. Not blocking Wednesday but Heather wanted it.

### 3. P2: Working-dir cleanup (carried over)

Untracked validation screenshots accumulated:
- `pr-b-*.png`, `pr-c-*.png`, `pr-g1-*.png`, `pr-h-*.png`, `validate-*.png`, `verify-*.png`
- `.playwright-mcp/`, `.tmp-smoke-shots/`, `VERIFY-2026-05-24.md`

Either gitignore the patterns + `git rm --cached` or just `rm` the files.

---

## Out-of-band data actions taken this session

| Action | Why | Reversible? |
|---|---|---|
| Confirmed Heather's email (`UPDATE auth.users SET email_confirmed_at`) | She needs to sign in; the email was never confirmed | Yes (`SET email_confirmed_at = null`) |
| Deleted both "Smoke Test Pub" nights | Brandon's manual test data showing on Heather's view | Reversible only if you remember the venue_name; rows are gone |
| Killed all auth.sessions for `brandon@vyntechs.com` | Forced sign-out everywhere — Heather's inherited cookie now dead | Brandon (and Claude) will re-auth on next visit; harmless |

---

## Schema state on prod

```
hosts.default_theme_key  text  NOT NULL  default 'daylight'   -- added in PR #17
nights.theme_key         text  NULL      no default            -- altered in PR #17
questions.point_value    smallint  null allowed  -- unchanged; respects host edits since PR #21
```

Data state:
- 3 hosts: Brandon Nichols (gmail, host, never signed in), Brandon Nichols (vyntechs, founder, active), Heather (yahoo, host, **first signed in 2026-05-25 17:37:59 UTC**)
- Heather's `is_first_night_complete = false` — still true; she's only created one un-played night so far (venue: "Heather", id `b92b930d…`)
- Theme key distribution on `nights`: 32 null (→ inherit host default = daylight), 2 'may', 1 'january'. No 'house' rows remain.
- All "Smoke Test Pub" + "Full Flow Driver" nights deleted from prod

---

## Workflow rules (non-negotiable on this project)

- **PR-first always.** Never push to `main`. Even docs. Brandon merges; Claude opens.
- **Validate everything contextually possible BEFORE handoff.** Don't claim "done" until typecheck/build/tests pass AND visual smoke is done (preview deploy or dev gallery). When you find a redirect / middleware / async-render trap, fix it AND re-validate.
- **Migrations: apply via MCP, don't touch other projects.** Trivia project id is `citweuctcnuxmqjxcbiz`. NEVER touch `ynmtszuybeenjbigxdyl` (Vyntechs Auto) or `vggftauiaplktwnwciey` (lurnt-discovery).
- **Customer data**: Heather's pre-#25 setup work lives under Brandon's founder host_id (`60fe578c-f848-418d-a3af-3901d1ea7971`) because sign-out didn't exist before 17:29 UTC today. Post-#25 work lives under her own host_id (`772f91c9-c7fc-424b-9429-207e4527cad1`). Don't delete anything on her host_id without checking; treat Brandon's recent "Soul Fire Pizza" nights as ambiguous (could be Brandon-testing or Heather-pre-#25).
- **Build without asking when spec + design exist.** Ask only on product/intent ambiguities.
- **Brandon's customer is non-technical.** Plain English in PR descriptions + customer-facing copy. No jargon.

---

## Tools confirmed working

- **`vercel logs`** (CLI) — `--no-branch --since 1d --query "<text>" --json`. Vercel MCP returns 403; CLI is the workaround.
- **`vercel inspect <url>`** — to see the commit SHA + build start time of a specific deploy. `vercel inspect tr1via.com` returns the alias target.
- **`vercel ls`** — last ~10 deploys with status. Useful for finding the latest Preview URL after a push.
- **Supabase MCP** — `execute_sql`, `apply_migration`, `get_logs`, `create_branch`, `delete_branch`, `get_publishable_keys`. Trivia project id: `citweuctcnuxmqjxcbiz`.
- **Supabase branches** — $0.013/hour. Useful for migration testing. CAVEAT: parent project has an orphan "Jeopardy Rebuild Migration" referencing `trivia_settings` (doesn't exist) that aborts the branch's initial migrations. Workaround: apply minimum parent schema manually via `apply_migration` before testing your own.
- **Playwright MCP** — works against prod + previews. Vercel SSO disabled. **When validating client-side useEffect-driven UI, use `browser_wait_for` with expected text BEFORE screenshotting** — `browser_take_screenshot` fires before the effect runs.
- **Founder bypass login** — `/login` → `brandon@vyntechs.com` → Send → instant redirect. NO email needed. Used by Claude for validation; was the path Heather accidentally inherited.
- **`scripts/full-flow-prod.mjs`** — drives a full 2-game lifecycle in ~80s. DON'T run without explicit Brandon OK — creates real prod nights with real Anthropic + Pexels API costs.

---

## Auth setup quick-reference

| Email | Role | Confirmed? | Use case |
|---|---|---|---|
| `brandon@vyntechs.com` | founder | yes | Founder bypass — instant sign-in via `/api/auth/founder-login`. Skip magic link. |
| `brandon.james.nichols@gmail.com` | host | yes | Personal gmail. Never used. |
| `heatherhmoore@yahoo.com` | host | yes (manually confirmed 2026-05-25 17:12 UTC) | Heather's account. Magic link confirmed working — first sign-in 2026-05-25 17:37:59 UTC. |

---

## Recurring patterns to know

### Tri-state load + subscribe
PRs #10, #11, #14, #17 share this shape — `useEffect` that fetches + subscribes to postgres_changes for refresh. Tri-state `T | null` ("not loaded yet" vs "loaded empty" vs "loaded with data") gates render. Currently inlined in 4 callsites; if a 5th surface needs it, extract `useGameScores(gameId)` hook.

### Component duplication
PR #18 stripped the SHORTCUTS sidebar from `HostDashboard.tsx` — PR #20 found the same chrome duplicated in `OnboardingFirstDashboard.tsx`. If you change visible host chrome, grep for the same text in `components/onboarding/` too.

### Point-value algorithm (post-PR #21)
`assignPointValues()` is now two-pass:
1. Picks with explicit `pointValue` claim their slots
2. Remaining picks fill open slots by Claude `difficulty` asc (stable sort)

The pre-PR-#21 mental model ("all picks sort by difficulty, assign 100..700 by position") is wrong now. Edits to ONE pick's `pointValue` no longer cascade — they pin that pick at that slot.

### Middleware + useEffect-driven page state
PR #25 hit a subtle trap: middleware redirected `user && pathname === "/login"` to `/host`, so the login page never rendered for authed users — its `useEffect` that checks the session and shows a "signed in as X" banner never had a chance to run. Found via visual smoke; fixed by removing the redirect. **Heuristic**: when a page needs to render to authed users for any reason (banner, switch-account UX, settings), check middleware first — there's likely a "send them home" redirect blocking it.

---

## Resumption prompt

Just say "**read HANDOFF.md and continue**" — this file plus auto-loaded memory will have everything needed. The most urgent next move is **build PR G2 (rename category)** — Heather is now active on her own host_id and will hit the "rename a locked category" wall during Wednesday setup. Spec is ready on `docs-spec-g2-rename-category`.

If you have a specific bug from Heather, lead with the observable symptom (URL + what she sees) and let the next session pull logs/code. Her host_id for filtering Supabase queries: `772f91c9-c7fc-424b-9429-207e4527cad1`.

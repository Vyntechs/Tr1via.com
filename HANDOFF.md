# TR1VIA — Handoff (end of session 10, 2026-05-25)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs live in git history (session 9 at `3b14f4c`).

---

## Critical context

**Heather (`heatherhmoore@yahoo.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons, not a demo. **2 days out.**

🚨 **Two PRs are OPEN awaiting your validation + merge** — see "What's still open" below. Migration 0006 + 0007 are ALREADY APPLIED to prod Trivia (`citweuctcnuxmqjxcbiz`), so don't re-apply them.

---

## What shipped this session (session 10)

### Merged to main (your call, during the session)

| PR | What | Status |
|---|---|---|
| #14 | `fix(reveal)`: wire game_scores into player room so in-game rank stops showing "#0" — mirrors PR #10 pattern, also fixes PlayerJoinGame2 (third surface with same bug) | merged |
| #15 | `feat(player)`: phone shows question prompt + image during gameplay — question text gets primary weight, ~72px thumbnail when image present, drops "Read the question on the TV" caption | merged |
| #16 | `feat(host)`: section-ended picker — option B with auto-start lowest. New `TVSectionEndedPicker` replaces dead grid when one section ends + others have unplayed questions. One tap → auto-reveal lowest-points unplayed question. | merged |

### Open (need your validation + merge)

| PR | What | Notes |
|---|---|---|
| **#17** | `feat(theme)`: host-default theme architecture — adds `hosts.default_theme_key` column, makes `nights.theme_key` an optional override, central `resolveTheme()` helper, wraps host layout in ThemeProvider. **Migrations 0006 + 0007 already applied to prod.** Code merge will activate the cascade. | OPEN |
| **#18** | `chore(host)`: strip broken sidebar shortcuts — kills 5 stub routes (`/host/library`, `/host/nights`, `/host/settings`, `/host/themes`, `/host/venues`) + the `ComingSoonPage` component. SHORTCUTS section removed from dashboard sidebar. | OPEN |

**Validation order recommended**: merge #18 first (pure subtraction, lowest risk), then #17 (theme architecture — visual smoke test on preview after merge).

---

## What's still open

### 1. 🚨 P0: Build the real `/host/themes` picker page

**This was explicitly scheduled for THIS session by Brandon.** Quote: "a first. then lets handoff and have next session after i clear context to do b" — where (a) = strip sidebar (PR #18, done) and (b) = build the real themes picker.

Context: PR #17 added `hosts.default_theme_key` (column on the `hosts` table) + `resolveTheme()` helper. The host layout now wraps in `<ThemeProvider themeKey={host.default_theme_key}>`. But the only way to **change** the host default is via SQL — the `/host/themes` route was a stub and PR #18 deleted it entirely.

Build it back as a real picker:

**Files to touch:**
- **NEW** `app/host/themes/page.tsx` — server component, fetches authed host, hands off to client wrapper
- **NEW** `app/host/themes/HostThemesClient.tsx` — client component, renders the theme grid + on-pick PATCH
- **NEW** `app/api/hosts/default-theme/route.ts` — `PATCH` endpoint that updates `hosts.default_theme_key` for the authed host (use `getAuthedHost()` from `lib/api/auth.ts`)
- **Edit** `components/host/HostDashboard.tsx` — re-add a single "Themes" link to the (now-empty) sidebar shortcuts area, pointing to `/host/themes`

**Reuse:**
- `components/shared/PalettePeek.tsx` — the existing per-night theme picker overlay. The new page can wrap or copy from it. Same `ThemeKey` set.
- `lib/theme/tokens.ts` — `THEME_KEYS`, `TR1VIA_THEMES`, `isThemeKey` helpers

**Use brainstorming skill first** — this is creative UI work (theme grid layout, what happens after pick, preview). Brandon explicitly asked for design care in similar work last session (PR #15 phone Q+photo).

After this lands: Brandon has full UI control over host theme. The whole arc that started with PR #13 is closed.

### 2. P1: Working-dir cleanup

The repo has accumulated test artifacts that aren't gitignored:
- `.playwright-mcp/`, `.tmp-smoke-shots/`
- `VERIFY-2026-05-24.md`
- 14+ `verify-*.png` and `pr-*.png` screenshots
- `.next/`, `node_modules/`, etc. are properly ignored

Two clean-up paths:
- Add `.gitignore` entries for `verify-*.png`, `pr-*.png`, `.playwright-mcp/`, `.tmp-smoke-shots/`, and one-time `git rm --cached` them
- Or `rm` the local files

Not blocking, just clutter.

### 3. P2: Anthropic gen monitoring (carried from session 9)

If gen failures resurface:
```bash
vercel logs --environment production --since 1d --query "generateQuestions" --json --no-branch
```

---

## Workflow rules (non-negotiable on this project)

- **PR-first always.** Never push to `main`. Even docs. Brandon merges; Claude opens.
- **Validate everything contextually possible BEFORE handoff.** Don't claim "done" or hand over a PR until typecheck/build/tests pass and the underlying mechanics are proven (e.g. via Supabase branch for migrations).
- **Migrations: apply via MCP, don't touch other projects.** Trivia project id is `citweuctcnuxmqjxcbiz`. The org also has `ynmtszuybeenjbigxdyl` (Vyntechs Auto) and `vggftauiaplktwnwciey` (lurnt-discovery) — NEVER touch those.
- **Drive the actual flow before claiming "fixed."** Use the `verify` skill or `scripts/full-flow-prod.mjs`.
- **Build without asking when spec + design exist.** Ask only on product/intent ambiguities.
- **Cross-check log inference.** Don't infer cause from Supabase timing alone; pull Vercel function logs.

---

## Recurring pattern: tri-state load + subscribe

PRs #10, #11, #14, #17 all share the same fix shape — a `useEffect` that fetches data + subscribes to postgres_changes for refresh. Tri-state `T | null` ("not loaded yet" vs "loaded empty" vs "loaded with data") to gate render so we don't paint placeholder values.

Currently inlined in 4 callsites (host live console, recap, player room, PlayerJoinGame2Wired). If a 5th surface needs it, extract `useGameScores(gameId)` hook — that's the threshold per Brandon's "3 similar lines > premature abstraction" rule.

---

## Tools confirmed working on this project

- **`vercel logs`** (CLI) with `--no-branch --since 1d --query "<text>" --json` — Vercel MCP returns 403, the CLI is the workaround.
- **Supabase MCP** — `mcp__plugin_supabase_supabase__execute_sql`, `apply_migration`, `get_logs`, `create_branch`, `delete_branch`. Trivia project id: `citweuctcnuxmqjxcbiz`.
- **Supabase branch testing** — `create_branch` costs $0.01344/hour. Add column + alter constraints can be tested for ~$0.005 in 15 minutes. **CAVEAT**: branch creation currently fails on parent schema (orphan "Jeopardy Rebuild Migration" referencing non-existent `trivia_settings` table from some pre-tr1via experiment). Workaround: apply just the minimum needed parent tables manually via `apply_migration` to the branch, then test your migration on top.
- **Playwright MCP** — works against `tr1via.com` and preview deploys. Vercel SSO disabled.
- **Founder bypass login** — `/login` → `brandon@vyntechs.com` → Send → immediate redirect to `/host`. No email needed.
- **`scripts/full-flow-prod.mjs`** — drives a full 2-game lifecycle in ~80s against tr1via.com. (DON'T run unless asked — it creates + cascade-deletes a real prod night with real Anthropic + Pexels API costs.)
- **`gh pr create`** / **`gh pr view`** — used for every PR this session.

---

## Schema state on prod (post-PR-17 migrations)

```
hosts.default_theme_key  text  NOT NULL  default 'daylight'   -- NEW
nights.theme_key         text  NULL      no default            -- WAS NOT NULL default 'house'
```

Existing data (as of session 10 end):
- 3 hosts: all backfilled to `default_theme_key='daylight'` (column default)
- 32 nights: 30 backfilled from 'house' → null (will inherit host default once PR #17 code is merged), 1 = 'may' override, 1 = 'january' override

If PR #17 doesn't merge but the migration stays applied: the OLD code reads `night.theme_key ?? "house"`, so null nights render "house" (visually identical to pre-migration). No prod break. Safe.

---

## Resumption prompt

Just say "**read HANDOFF.md and continue**" — this file plus auto-loaded memory will have everything needed. The next concrete task is **build the real `/host/themes` picker page** (see "What's still open #1" above).

If anything looks off in prod first, lead with the observable symptom (URL + what you see) and let the next session pull logs/code.

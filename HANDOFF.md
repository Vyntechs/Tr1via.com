# TR1VIA — Handoff (end of session 12, 2026-05-25 evening)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs live in git history (session 11 close at `a408275`, session 10 at `04b6979`).

---

## Critical context

**the first host (`host@example.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons. **2 days out.**

**Tonight (Mon 2026-05-25 evening): Brandon is running a full game with a few friends to find bugs.** Be ready for bug reports in the next session. When one comes in: lead with what was on the screen + literal text from the screenshot, pull Vercel logs (`vercel logs --no-branch --since 1d --query "<text>"`) + Supabase MCP scoped to the relevant host_id, propose a fix in a feature branch, validate visually on preview before claiming done.

---

## What shipped this session (session 12)

| PR | What | Status |
|---|---|---|
| #27 | `fix(auth)`: when authed, `/login` shows "Go to your dashboard →" CTA instead of magic-link form (closes the "click Send sign-in link 5 times → email rate limit" loop the first host hit) | **merged** |
| #28 | `feat(auth)`: passwordless instant-email-login + founder-grant-magic-link UI on `/host/admin` | **mergeable, awaiting Brandon's merge** |

**PR #28 contents (one branch, four behaviors):**
- `POST /api/admin/grant-magic-link` — founder-only, generates a `<site>/auth/grant?t=<token>` URL for any registered host.
- `GET /auth/grant?t=<token>` — server-side OTP exchange; writes auth cookies on response; redirects to `/host`. The cross-device path: founder texts/AirDrops the URL, host taps it, lands signed in.
- `/host/admin → SEND A SIGN-IN LINK` panel — email input, Generate button, URL with Copy button. Founder-only UX.
- **Magic-link removed entirely from `/login`.** Typing any registered host email → server mints that host's session in one request (no "Check your email" anywhere). Unknown emails get an inline 404 error pointing to "ask Brandon to comp you."

Validated end-to-end on preview (`tr1via-cy1kqzyfg…`): Brandon's email → instant `/host`. the first host's email → instant `/host` with her data (venue, room code, host_id). Bogus email → inline error. After sign-in, re-visiting `/login` shows the SignedInPanel (no form). `hasCheckEmail: false` everywhere.

---

## 🚨 P0 carry-over: clone the first host's WIP to her host_id

the first host did her Wednesday-night setup on **Brandon's founder host_id** before sign-out existed (pre-PR #25, before 17:29 UTC). She lost access to it the moment she signed in on her own account. She needs it back.

**Source identified:** night `655995cb-d2d8-4ffc-81e6-64c0754e3c56` under Brandon's host_id (`60fe578c-f848-418d-a3af-3901d1ea7971`).
- Created 2026-05-25 12:05 UTC, venue **Soul Fire Pizza**, theme **may**
- Game 1: 6 categories all locked (state=ready), 42 questions picked
  1. types of skirts through the years
  2. Kyle Bush
  3. Girl bands (19 candidates, 7 picked)
  4. Work Boots (40 candidates — she regenerated once)
  5. martial arts
  6. Pickles
- Game 2: 1 category in review (Prisons), 0 picks
- Total candidate pool: 159 questions

**What to do next session:**
1. **Deep-copy** the night to the first host's host_id (`772f91c9-c7fc-424b-9429-207e4527cad1`) in one transaction:
   - New `nights` row (host_id = the first host, copy venue/theme/scheduled_at/etc., new id)
   - 2 new `games` rows (game_no 1 + 2, new ids)
   - 7 new `categories` rows (preserve position/name/topic/state, new ids)
   - 159 new `questions` rows (preserve prompt/options/correct_index/difficulty/**point_value**/**is_picked**/source/image_url, new ids)
2. **Leave the original on Brandon's host_id untouched** — Brandon's call from session 12.
3. **Spot-check `image_url`**: if any are Supabase Storage paths keyed by host_id, the clones might 403. Pexels URLs (public) and host-uploaded ones with absolute URLs are fine. Run a quick HEAD check on the first few before claiming done.
4. **Tell Brandon**: "the first host can log in now; her Wednesday setup is in her dashboard."

Don't ask for confirmation again — Brandon already confirmed in session 12 ("she can only work on one night at a time"). Just do it, take care, verify.

---

## Auth model — what changed and stays true

**As of PR #28:** sign-in is `type email → in`. No magic links, no email round-trip, no "Check your email" screen.

- Any email in the `hosts` table can sign in by typing it at `/login`.
- New hosts onboarded only via `/host/admin → Comp a host` (founder-gated). Unknown email at `/login` → inline 404 error.
- Cross-device case: `/host/admin → SEND A SIGN-IN LINK` produces a `<site>/auth/grant?t=<token>` URL to text the host.
- Trust boundary: the `hosts` table is the gate. The founder gates the table.

Memory: `project-auth-model-type-email-in.md` and `feedback-no-friction-without-security-gain.md` in `~/.claude/projects/.../memory/`.

---

## Open work (after the clone)

### P1: Build PR G2 (rename category) — WIP commit exists

Spec: `docs/superpowers/specs/2026-05-25-pr-g2-rename-category.md` on branch `docs-spec-g2-rename-category`. **WIP commit `493307b` on branch `feat-rename-category`** — has the schema + new PATCH route done, plus mid-edit on `HostGenPick.tsx` (references undefined `EditableTopicEyebrow` — typecheck would fail until finished). Resume by reading the spec's §4 + §6 then finishing `EditableTopicEyebrow` inline component + wiring `HostSetupPickClient`.

the first host will hit "I can't rename a locked category" on Wednesday if not shipped.

### P2: Build PR G3 (write your own custom question) — spec only

Spec: `docs/superpowers/specs/2026-05-25-pr-g3-custom-question.md` on branch `docs-spec-g3-custom-question`. Not blocking Wednesday but the first host wanted it.

### P3: Working-dir cleanup

Untracked validation screenshots from sessions 11 + 12 — `validate-pr27-*.png`, `validate-pr28-*.png`, `validate-noemail-*.png`, plus older `pr-*.png`, `verify-*.png`, `smoke-*.png`. Either gitignore the patterns + `git rm --cached` or just `rm` the files.

### P4: `npm run lint` broken on main

`next lint` was removed in Next 16. The script in `package.json` just errors out. Replace with `eslint .` (or whatever the project wants) in a small chore PR.

---

## Out-of-band data actions taken this session

| Action | Why | Reversible? |
|---|---|---|
| Generated 3 short-lived magic-link URLs for the first host via Supabase admin SDK | Manual unblocking during the rate-limit incident; superseded by /host/admin tool | Self-expire in ~1hr; first one was consumed on use |
| **Nothing to her actual data** | — | — |
| Several validation Playwright sessions signed in as the first host on previews — may have created 2 small "the first host"-venue nights under her host_id (ids `30cbd106…`, `b37e7808…`) | Test data from validation flows | Safe to delete if cluttering; the first host's real Wednesday work lives on Brandon's host_id (see P0) |

---

## Tools confirmed working

- **`vercel logs`** — `--no-branch --since 1d --query "<text>" --json`. Vercel MCP is 403; CLI is the workaround.
- **`vercel inspect <url>`** — to confirm a deploy is Ready, see commit SHA + target.
- **`vercel ls`** — last ~10 deploys with status. Useful for finding the latest Preview URL after a push.
- **Supabase MCP** — `execute_sql`, `apply_migration`, `get_logs`, `get_publishable_keys`. Trivia project id: `citweuctcnuxmqjxcbiz`. Get-logs maxes 24h.
- **Playwright MCP** — drives prod + previews. Vercel SSO disabled.
- **Email-login bypass for Claude** — `/login` → any host email → instant sign-in. Use brandon@vyntechs.com for founder ops, host@example.com to validate as her.
- **`scripts/grant-on-preview.mjs`** — one-off Node script to mint a `/auth/grant?t=...` URL pointed at any preview deploy. Read `.env.local` for SERVICE_ROLE_KEY. Dev tool, committed.

---

## Schema state on prod

```
hosts.default_theme_key  text  NOT NULL  default 'daylight'
nights.theme_key         text  NULL      no default
categories.name          text  NOT NULL  (host-renamable post-G2)
categories.topic         text  NOT NULL  (Claude prompt; immutable post-generation)
questions.point_value    smallint  null allowed  (respects host edits since PR #21)
```

No schema changes in session 12.

---

## Workflow rules (non-negotiable on this project)

- **PR-first always.** Never push to `main`. Even docs. Brandon merges; Claude opens.
- **Validate everything contextually possible BEFORE handoff.** Drive the real user flow on the preview before claiming done. Brandon will catch overclaims (session 12 lesson — see [[feedback-validate-dont-just-claim]]).
- **Don't ask permission for engineering decisions when a spec + design exist.** Do ask for product/intent ambiguities.
- **Brandon's customer is non-technical.** Plain English in PR descriptions + customer-facing copy. No jargon.
- **Migrations: apply via MCP, don't touch other projects.** Trivia id: `citweuctcnuxmqjxcbiz`. NEVER touch `ynmtszuybeenjbigxdyl` (Vyntechs Auto) or `vggftauiaplktwnwciey` (lurnt-discovery).
- **Magic-link is gone.** When asked about auth, never suggest magic-link / email-confirm / OTP round-trips for known hosts. See [[feedback-no-friction-without-security-gain]].

---

## Resumption prompt

After `/clear`, type:

> **read HANDOFF.md and continue**

That plus auto-loaded memory will reorient. If Brandon has a specific bug from tonight's game, the first message can be the screenshot + literal error text — that's enough to start.

The most urgent move on a clean start with no bug report is **clone night `655995cb` to the first host's host_id** (§ "P0 carry-over" above). Brandon already confirmed scope; just do it carefully and verify.

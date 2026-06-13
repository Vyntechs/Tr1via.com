# TR1VIA — Handoff (2026-06-09 — Terms of Service shipped + merged; Phase B is next)

**Next session, read in order: this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → grep `tasks/lessons.md` → `tasks/todo.md`.**

---

## ⭐ Where we are
Working the **free/paid go-live in sequence A → B → C** (Brandon's chosen order). **Phase A (Terms of Service) is DONE, MERGED, and LIVE.** Phase B is next.

- **PR #98** (`feat(legal): publish Terms of Service at /terms`) **squash-merged** → `origin/main` = **`b0810d0`**. ToS is live at **tr1via.com/terms** (auto-deployed).
- ToS is a hand-written server component mirroring the privacy page; plain-text mirror at `docs/legal/terms-of-service.md`. **Terms** linked beside **Privacy** in 5 places (host login, player join, pricing/themes/trivia-night footers).
- Brandon approved the 4 flagged legal defaults as-is: **no refunds · 18+ hosts · liability cap (greater of 12-mo fees or $100) · attorney pass recommended (not yet done).**

## ⭐ Immediate next step — Phase B (part 1): make public signup safe, then merge it
**The signup code already exists but is UNMERGED and has a known security hole that must be fixed first.**
- The signup work sits in worktree `.claude/worktrees/pivot-accounts-auth` (commit `6397c02`, LOCAL ONLY): `app/api/auth/register/route.ts` + `app/(host)/login/page.tsx` (Google + password + register) + 11 tests. It was built off **pre-billing** main → must be **replayed cleanly** onto current `origin/main`, not merged with its divergent history.
- **SECURITY GATE (fix before signup merges):** `app/api/auth/founder-login/route.ts` signs in ANY email that has a hosts row **without a password check**. Once public register ships, a stranger could sign in as any self-registered host just by typing their email. This touches Brandon's + Heather's login → **plan the fix and get Brandon's approval BEFORE writing code.** Recommended zero-lockout approach: tag self-registered accounts; founder-login refuses passwordless login for them; founder + Heather keep their magic-link path.

### Copy-paste brief for Phase B part 1 (set `/effort xhigh`):
```
Phase B (part 1 of free/paid go-live): make public signup safe, then merge it.

Goal: A stranger can register as a free host (email/password or Google) with NO way to hijack an existing host's account — signup code merged to main behind a PR, but NOT yet advertised publicly. Heather and the founder are completely unaffected.

Scope:
- app/api/auth/founder-login/route.ts — close the passwordless-login hole.
- The unmerged pivot-accounts-auth worktree (commit 6397c02): app/api/auth/register/route.ts, app/(host)/login/page.tsx + tests — replay cleanly onto CURRENT origin/main (built off pre-billing main).

Out of scope: Do NOT touch Heather's or the founder's account/data, players, or the game state machine. Do NOT build email infra (Zoho/ZeptoMail/DNS), change Supabase dashboard settings, or touch billing — later Phase B steps. Do NOT advertise/link public signup yet. Do NOT delete or recreate any auth user.

Steps:
1. FIRST, plan only — do not write code yet: re-verify current /api/auth/founder-login behavior and the pivot-accounts-auth register code, then propose a zero-lockout fix for the passwordless hole (e.g. tag self-registered accounts; founder-login refuses passwordless for them; founder + Heather keep magic-link). Write to tasks/todo.md and WAIT for my approval.
2. After approval: implement the security fix with tests (RED first).
3. Replay the signup work (register route + login page + tests) cleanly onto current origin/main as one PR — don't merge divergent pre-billing history.
4. Open the PR; I review + merge.

Verify by: Full test suite green (incl. new tests). On LOCAL dev (not prod): a new email/password signup creates a hosts row with is_paywall_bypassed=false, AND a self-registered email is REFUSED on the passwordless magic path while a founder/comped email still signs in. Do not run a prod login test or full-flow-prod this week (Heather is building live).
```

## Phase B remaining (later, NOT part 1)
- **Email infra (§5.3):** Brandon buys Zoho Mail Lite inbox + creates ZeptoMail account + adds SPF/DKIM DNS. Then wire Supabase custom SMTP to ZeptoMail + update privacy policy to name ZeptoMail. Real email confirmation for new hosts depends on this.
- **Supabase dashboard toggles (Brandon):** enable Google provider + client ID/secret; add `https://tr1via.com/auth/callback` to redirect allowlist; turn on email confirmation.

## Phase C (billing go-live) — verified state + what's left
- **Verified this session (read-only, prod):** all 5 hosts currently have AI. **Heather, founder, and Brandon's gmail are comped** ✓. The 2 non-comped (`the***@gmail`, `nic***@gmail`, created 06-08/09) are **Brandon's own test accounts** on active trials → ignore/clean up, no go-live concern.
- **No `is_paid` column** — entitlement derives "paid" from `subscription_status IN ('active','trialing')`. Columns on `hosts`: `is_paywall_bypassed`, `role`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`, `trial_ends_at`.
- **Stripe account:** exists as `Tr1via.com` (`acct_1TgCkjQpJ8eXP22U`). Read-only MCP only sees TEST mode (`livemode:false`). **Live activation NOT confirmed** — Brandon to verify/activate from the dashboard under the legal entity.
- **Legal entity decided:** Brandon personally, **sole proprietor d/b/a Vyntechs (Texas)**. (A DBA is not a separate entity — see lessons.)
- **Go-live still blocked on:** live Stripe activation + doing it *after* Heather's show this week (prod env change near her live game = risk). The flip itself is ~10 min (live product/price/webhook + prod `STRIPE_*` env).

## Hard constraints
- **PR-first, never push/merge `main` yourself** — Brandon merges. (He merged #98 himself.)
- **NEVER put `sk_test_` keys in PROD env.** Test keys → preview only; live keys → prod at go-live.
- Entitlement is ALWAYS `founder OR comped OR paid OR active-trial`, founder/comped checked FIRST — Heather (comped) can never be locked out.
- **Heather is building a live game this week** — no prod login tests, no `full-flow-prod` (founder-collision risk), no prod env changes until her show is done.

## Git state (verified + synced 2026-06-09)
- `origin/main` = **`b0810d0`** (ToS #98). Start Phase B from a fresh branch off `origin/main`.
- Current checkout is the merged `feat/terms-of-service` branch — safe to delete; create the Phase B branch off `origin/main`.
- **Stash `stash@{0}`** holds Brandon's pre-session uncommitted edits (HANDOFF.md + tasks/lessons.md + scratch files), stashed off `fix/reroll-stale-questions-404` to build the ToS on a clean branch. Restore with `git stash pop` when back on that branch. (This handoff overwrites the working-tree HANDOFF.md regardless.)
- Billing worktree `.claude/worktrees/stripe-billing` is fully merged (#92) → safe to remove. `pivot-accounts-auth` worktree is NEEDED for Phase B (don't remove yet).

## Lessons logged this session
- `dba-is-not-a-separate-legal-entity` — the legal party on Stripe/ToS is the individual d/b/a the trade name, not the DBA itself.

## Skipped/Failed
None. Phase A complete and merged. Phase C live steps intentionally deferred (blocked on Stripe activation + Heather's week).

## Resume prompt
Read HANDOFF.md in full and tell me where we left off.

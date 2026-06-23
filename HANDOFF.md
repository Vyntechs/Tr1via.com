# TR1VIA — Handoff (2026-06-22 — Seasonal public-site theming + front-door theme toy SHIPPED to prod)

**Next session, read in order: `MEMORY.md` (auto-loaded — canonical state) → this → `CLAUDE.md`/`AGENTS.md`.**

> Note: this handoff was written in the leftover worktree `.claude/worktrees/seasonal-public-theme` (now on `main`, post-merge). It is committed there but NOT pushed (PR-first). The reliable cross-session record is **MEMORY.md**, which is auto-loaded.

---

## Where we are (one line)
**SHIPPED + LIVE on prod:** every public page now auto-wears the current calendar month's theme, and the `/trivia-night` front door is an interactive "tap-through-the-months" theme toy. Merged via **PR #112** (squash `43567be` on `origin/main`) and verified live on tr1via.com.

## What shipped this session (live for users)
- **Whole public site follows the real month** (landing/marketing, `/join`, `/login`, `/themes` chrome, privacy/terms) — auto-rotates, flips to the July 4th look on July 1, no maintenance.
- **"The Year, In One Touch"** front door: the 12-month strip is a live controller — tap/hover a month → the WHOLE hero repaints (colors + product demo + real per-month weather). Opens on the live month, gently auto-drifts until touched, `prefers-reduced-motion` respected. The chosen season **follows the visitor across navigation** (join/login/etc.).
- New files: `lib/theme/monthThemeScript.ts`, `components/system/SeasonalThemeProvider.tsx`, `components/marketing/YearInOneTouch.tsx` (+tests). One small change to `app/layout.tsx`. Game/host/player/TV + the multi-theme showcase pages are deliberately unchanged.
- Spec/plan: `docs/superpowers/{specs,plans}/2026-06-22-public-site-monthly-theme*`.

## Verified by
- Pre-merge: `npm test` → **850 pass / 8 skip**; `npx tsc --noEmit` → clean (only 2 known baseline errors in `HostHomeClient-founder-build.test.tsx`).
- Post-merge: `git show 43567be --stat` = exactly the 15 theming files (nothing else). Live smoke on https://tr1via.com — toy present (12 month controls), opens on current month, tap repaints + holds, drift stops on interaction; `/join` + `/login` render the current month. Only console msg = pre-existing favicon.svg 404 (cosmetic).
- Rollback if ever needed: `git revert 43567be` + redeploy.

## Immediate next step (queued, NOT built) — "The Night-Stamp"
A shareable, auto-branded end-of-night keepsake card on every player's phone (venue brand auto-pulled from the host record — default "TR1VIA", "SoulFire Trivia" when Heather hosts; **no typing**). Tap → native share → friend taps `tr1via.com` link → lands on the themed front door → "Start your own — free." It's the zero-friction growth loop; Heather-safe (fires after scores lock, read-only to the live game). **Brandon-approved copy:** caption *"I just played SoulFire Trivia."* / footer *"Run your own night, free → tr1via.com"*. First action for a fresh agent: brainstorm → plan the Night-Stamp card (image + share button on `app/(player)/room/[code]/{won,recap}`, reusing `QRBlock`/`PlayerRecap`/`themeVars`).

**Also: Brandon has "a few other changes/improvements/implementations" for next session — not yet specified. Ask him to list them first.**

## Hard constraints / only-Brandon
- Deploy/merge/push-to-main = Brandon's call (PR-first, real users). Never deploy during a live Wednesday show.
- July fireworks ("pyrotechnics") are ALREADY live on prod (PR #110) — do not claim otherwise.

## Cleanup
- This worktree (`.claude/worktrees/seasonal-public-theme`) is leftover after the merge — safe to remove. Throwaway local branch `preview-combined` also created earlier (harmless).

---

## Resume prompt
```
Read HANDOFF.md in full and tell me where we left off, then ask me to list the "few other changes" I have queued.
```

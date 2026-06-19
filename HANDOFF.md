# TR1VIA — Handoff (2026-06-19 — July Pyrotechnics ALL 4 PHASES DONE + verified)

**Next session, read in order: this → `MEMORY.md` (auto-loaded) → `tasks/july-pyrotechnics-plan.md` → `tasks/july-pyrotechnics-phase4-report.md` → `CLAUDE.md`.**

---

## Where we are (one line)
**All 4 phases of "July pyrotechnics" are DONE + verified** on branch `fix/rls-correct-index-leak` (**commit-only — NOT pushed, NOT merged, NOT deployed**; local is ahead of `origin` by all four phases). The 4-phase effort is COMPLETE; what remains is Brandon's branch/deploy decision + a live multi-device visual confirmation.

## What shipped THIS session (Phase 4) — committed to `fix/rls-correct-index-leak`
The polish capstone — see `tasks/july-pyrotechnics-phase4-report.md`. **Transport/client only — no migration.**
- **July lock-in ceremony** (TV/host): registry entry `july: { marquee:true, ceremony:"fireworks" }` → marquee scoreboard + a per-player TINTED firework on the TV each time someone locks in (new `fireLockInBurst` in `Pyrotechnics.tsx`, dispatched by `TVLockInCeremony` — mirrors May's lightning, batched by the existing queue).
- **Finale build→erupt crescendo**: new `lib/game/crescendo.ts` + `lib/hooks/useCrescendo.ts` (rAF intensity ramp, throttled ~12/s, reduced-motion → peak) wired into `TVFinaleWinner` + `PlayerWinnerCard`. The "erupt" is the existing synchronized beat; the "build" is the ramp.
- **Contrast/cohesion sweep** (live `/dev` walk): sound — dark text on every saturated bg, cream never on red/gold. **No token change needed.** Marquee + reduced-motion fallback confirmed live.
- **Adversarial review (4 agents)**: 22 non-bugs + **1 real HIGH** — enabling `hasCeremony("july")` made July player phones fire May's LIGHTNING bolt (`PlayerLockInBolt` gated on generic `hasCeremony`). FIXED: gate on `ceremony === "lightning"` (`app/(player)/room/[code]/page.tsx:434`) + regression test + lesson `opting-into-a-shared-registry-flag-flips-every-consumer-on-every-surface`.

## Verified by
- `npm test` → **820 passed / 8 skipped, exit 0** (136 files). `npx tsc --noEmit` → only the 2 known pre-existing `HostHomeClient-founder-build.test.tsx` errors.
- eslint (run directly; `npm run lint` is project-broken on Next 16) → **0 new problems**; player route lints byte-identically to committed HEAD.
- Live `/dev/player` + `/dev/tv` sweep: cohesion good, July marquee renders, reduced-motion fallback confirmed, canvas path mounts clean.

## Hard constraints / what only Brandon does
- **Merge / push / deploy / migrations = Brandon only. Never during a live Wednesday show.** This branch is intentionally local — **push = a Vercel preview deploy** (outward-facing), so it's gated.
- **Live multi-device canvas motion is UNVERIFIED here** (no live July room + edge-runtime e2e block + headless-canvas-paint limitation). Confirm the lock-in fireworks + finale crescendo on a real TV + phones before any deploy.

## Pending / open (all Brandon's call)
1. **Branch decision** — local is ahead of `origin` by Phases 1–4. Push (preview) / open a clean `feat/july-pyrotechnics` PR / or hold.
2. **Live multi-device visual confirmation** of the phone + TV fireworks/crescendo before deploy.
3. **Optional**: fuller "mirror May" phone parity — a July firework flourish on the phone at lock-in (mirroring May's phone bolt). Deferred; small follow-up if wanted (see Phase 4 report).
4. Pre-existing uncommitted files left UNTOUCHED (NOT mine; per Brandon "commit only my files"): `app/dev/host/page.tsx`, `app/host/live/[nightId]/HostLiveConsoleClient.tsx`, `components/host/HostLiveConsole.tsx` (a cold-start "TUNING IN" connecting console), `tasks/todo.md`, plus untracked reports / `prod-*.jpeg` / `july-*.png` (W3 screenshots) / `.claude/worktrees/`.

## Resume prompt
```
Read HANDOFF.md in full and tell me where we left off.
```

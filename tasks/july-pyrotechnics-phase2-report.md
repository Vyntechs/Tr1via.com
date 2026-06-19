# July Pyrotechnics — Phase 2 Validation Report

**Date:** 2026-06-18
**Phase:** 2 of 4 — Synchronized "beat" conductor (TV + host preview)
**Gate decision:** ✅ **GO** — built + verified, **NOT merged/deployed** (hard gate; no deploy during live shows).
**Branch state:** changes are **uncommitted** on `fix/rls-correct-index-leak` (same branch Phase 1 was committed to). Commit/branch/merge is Brandon's call.

---

## What shipped (12 files, transport only — NO migration)

| File | Change |
|---|---|
| `lib/api/broadcast.ts` | `"fireworks"` event + `broadcastFireworks(roomCode, kind)`; `fireAt = serverNow + lead` (salvo 450ms / finale 700ms). Best-effort. |
| `components/system/Pyrotechnics.tsx` | Module beat: `publishPyrotechnicsBeat(kind, delayMs)` → `{id, kind, targetAtMs}`; engines schedule against the shared target (`planEngineBeat`) + de-dup by id → fires **once per surface** across the per-view remount; `fireBeat` injects salvo=3 / finale=7 air-bursts via existing `explode()`. |
| `components/system/PyrotechnicsBeatConductor.tsx` *(new)* | `computeBeatDelayMs`: wall-clock sync when clocks agree, receipt+lead fallback on skew, skip stale/malformed. Publishes; engines own ignition. |
| `components/system/index.ts` | Exports. |
| `lib/hooks/useRoom.ts`, `lib/hooks/useTVRoom.ts` | Handle `fireworks` → surface on a **separate** `lastFireworksBeat` (not `lastBroadcast` → no phone `myAnswers` refetch); no refetch triggered; stamp `receivedAtMs` locally. |
| `lib/room/roomSnapshotPayload.ts` | New field on the route-fallback mapper. |
| `app/api/questions/[id]/resolve/route.ts` | Emit salvo after resolve. |
| `app/api/games/[id]/end/route.ts` | Emit finale after game-end. |
| `app/tv/[code]/page.tsx`, `app/host/live/[nightId]/HostLiveConsoleClient.tsx` | Mount the conductor (page-level). |
| `tests/unit/pyrotechnics-beat.test.tsx` *(new)* | 18 tests. |

**Cadence (Brandon's call):** synchronized salvo on **every answer reveal (resolve)** + a bigger synchronized eruption at **game-end**. The full finale build→erupt crescendo remains Phase 4.

## The honest sync finding (why the design isn't the literal plan)
Applying the timers' offset (`serverNow − Date.now()`) to a `fireAt` from the *same* message reduces to "fire `lead` ms after receipt" — **no cross-screen sync gain**. The real drift is **post-receipt processing divergence** (TV waits on `/api/tv/snapshot` refetch + re-render; host does direct reads). Fix: schedule off the broadcast **receipt** at a **shared `fireAt`**, trusting the (NTP-accurate) wall clock with a skew fallback.

## Verification

| Gate | Result |
|---|---|
| `vitest run` | **768 passed / 0 failed** / 8 skipped (750 baseline + 18 new) |
| `tsc --noEmit` | only the 2 pre-existing `HostHomeClient` errors — **no new** |
| eslint | **0 new problems** (baseline = current = 4 pre-existing on the hooks); new files clean |
| **Live broadcast-jitter probe** (real Supabase Realtime, 2 subscribers, 8/8 delivered) | inter-subscriber gap **median 5ms / max 12ms** (< one 60fps frame); one-way latency ~71–79ms |
| **Adversarial review** (14-agent workflow) | 9 refuted, **1 confirmed → fixed**; focused re-skeptic confirmed the fix + 1 fail-soft hardening applied |

### The one confirmed defect (fixed)
My first cut added a "fire immediately on mount" catch-up. Because each TV view mounts its own engine, a slow refetch could fire the burst on the *outgoing* question screen at `fireAt`, then the reveal engine's catch-up would replay the **same beat late** → double-burst, out of step. **Fixed** with publish + per-engine schedule-against-shared-target + id de-dup (fires once per surface, at the shared instant). Lesson: `sync-beat-schedule-against-target-not-fire-on-mount`.

## What is NOT proven here (deferred, honestly)
- **The literal "two live screens + a real July resolve, recorded firing in unison."** Not runnable in this environment: no live July room, and local e2e against prod Supabase dies in the edge runtime (logged lesson `live-e2e-blocked-by-edge-runtime-fetch-in-this-env`). Substituted by: unit-proven scheduling + de-dup, the measured **5–12ms** delivery floor, and adversarial review.
- **Visual confirmation the canvas paints a burst on a beat** (jsdom has no 2D context). The `explode()` render path is unchanged from Phase 1 (already verified); only the beat *plumbing* is new. Best confirmed on a real two-screen setup — fold into Phase 3's multi-device run.

## Rollback
Revert the working-tree changes (or the commit, once made). No migration, no schema, no deploy → nothing persistent to undo. Non-July nights are unaffected by construction.

## Carry into Phase 3
- Mount the conductor + engine on player phones subscribed to the SAME `fireAt` (the field already flows through `useRoom`).
- Do the multi-device live run (3+ phones + TV) — that's where the recorded "whole room erupts together" + the canvas-visual + phone perf budget get verified.

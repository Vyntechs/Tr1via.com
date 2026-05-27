# May/Storm — Live-Question Magic

**Date:** 2026-05-27
**Status:** Design approved, ready for plan
**Scope:** TR1VIA — May/Storm theme only. Other themes unchanged.

---

## Summary

When the active theme is **May/Storm**, the live-question screen becomes a thunderstorm. Three coordinated changes:

1. **Question timer goes from 20s to 25s.**
2. **The TV bottom strip becomes an auto-scrolling player scoreboard** (replaces today's "lock-in pile" of name tiles), sorted by score descending.
3. **Locking in an answer triggers a lightning ceremony** that runs in two coordinated halves — a phone-side strike when the player commits, and a TV-side strike that lands on the player's chip in the scoreboard. Every lock-in is honored with a full ceremony, no exceptions.

The feature uses TR1VIA's existing infrastructure: per-player colors from `lib/player/playerColor.ts`, the "Apple/Pixar-grade" procedural lightning from `components/system/Lightning.tsx`, and the theme system's per-themeKey switch pattern modeled on `components/system/Weather.tsx`.

---

## Non-goals

- **Other themes are not changed.** January through April, June through December, plus `house` and `daylight`, all keep today's 20s timer, lock-in pile, and absence of transit ceremony. Future themes may register their own ceremonies — that's a separate design.
- **No new audio production.** Uses the existing `lib/audio/thunder.ts` thunder. No new sound effects authored.
- **No data-model changes.** All state already exists (player, lock-in event, score, theme).

---

## User experience

### TV (active theme = May/Storm, live question)

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER  · GAME · LIVE                  YOUR # IS YOURS       │
├──────────────────────────────────────────────────────────────┤
│       CATEGORY · GEOGRAPHY                       100 PTS     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│       Which U.S. state has the longest coastline?    [25s]  │
│                                                              │
│   ┌──1──┐  ┌──2──┐  ┌──3──┐  ┌──4──┐                       │
│   │FLA  │  │ALSK │  │CAL  │  │MNE  │                        │
│   └─────┘  └─────┘  └─────┘  └─────┘                        │
│                                                              │
│   ╔══ SCOREBOARD MARQUEE · sorted by score desc ════════════╗│
│   ║ ● SARA 8400  ● MARK 7900  ● ALEX 7200  ● JULES 6800 ▸▸ ║│
│   ╚══════════════════════════════════════════════════════════╝│
└──────────────────────────────────────────────────────────────┘
```

- **Marquee** auto-scrolls left when chips overflow the visible width. Scroll speed tuned to player count, target ~20s for a full cycle.
- **Chip** carries: player color dot, name (truncated to 12 chars), score.
- **Sort:** score descending; ties broken by join order. Re-sort happens at reveal, not mid-question.

### Lock-in ceremony

**Phone side (player taps "Alaska"):**

1. Tap registered → `useAnswerSubmit` POSTs to server.
2. Wait for server confirm (~150–300ms typical). **DB is source of truth — if the ceremony plays, the lock landed.**
3. On confirm: option charges with player color → mini-bolt strikes off the top of the phone with strobe flash → transition to `PlayerLocked` screen. Total phone ceremony ≈ 700ms.
4. Phone audio: **none**. Haptic + visual only. 30 phones playing thunder would be noise pollution.

**TV side:** runs in one of two modes, auto-switched by load.

**Calm mode** (≤1 lock-in pending):

- Mark's chip slides to center of marquee
- Bolt strikes from above, tinted to Mark's color
- Screen flash (existing Lightning component behavior)
- Thunder beat (existing `playThunder`)
- Chip slides back to its sorted position
- If `msToLock < 5000`: brighter/thicker bolt + `+SPD` badge briefly attached to chip

**Storm mode** (2+ pending, or 3+ locks in the last 1.5s):

- No center-pull spotlight
- Each chip's bolt strikes in place wherever it sits in the scroll
- Multiple bolts can strike simultaneously
- Thunder uses Lightning's existing leader/return/subsequent stroke pattern: first strike loud, follow-ups roll into a thunderstorm
- Each chip still gets its own bolt, its own flash, its own thunder beat — every player's ceremony is delivered

The auto-switch is a function of pending-queue depth + recent strike count, computed on every frame.

---

## Architecture

### Theme-pluggable ceremony (new)

**File:** `lib/theme/lockInCeremony.ts` (new)

A registry keyed by `ThemeKey`:

```ts
interface LockInCeremonyConfig {
  duration: number;              // question timer in seconds
  marquee: boolean;              // bottom strip = marquee vs pile
  ceremony: CeremonyImpl | null; // strike behavior, or null = no transit
  // Future: per-theme tint logic, sound, etc.
}

const REGISTRY: Partial<Record<ThemeKey, LockInCeremonyConfig>> = {
  may: {
    duration: 25,
    marquee: true,
    ceremony: LightningCeremony,
  },
  // No other themes register. Defaults below.
};

const DEFAULT: LockInCeremonyConfig = {
  duration: 20,
  marquee: false,
  ceremony: null,
};

export function lockInCeremonyFor(themeKey: ThemeKey): LockInCeremonyConfig {
  return REGISTRY[themeKey] ?? DEFAULT;
}
```

This parallels the existing `Weather` component's per-themeKey switch (`components/system/Weather.tsx`). Every conditional branch in the new code reads from this single registry.

### Components

**New:**

- `components/tv/TVScoreboardMarquee.tsx` — auto-scrolling chip strip with center-pull behavior, sort logic, mode switching, reduced-motion handling, aria-live region for screen reader announcements.
- `components/tv/TVLockInCeremony.tsx` — receives lock-in broadcasts, manages the calm/storm mode state, resolves chip x-positions, fires Lightning bolts with player-color tint, drains a small in-memory queue.
- `components/player/PlayerLockInBolt.tsx` — phone-side mini-bolt. Uses `lightning-bolt.ts` geometry at smaller scale. Plays only after server-confirmed.

**Modified:**

- `components/system/Lightning.tsx` — add `tint?: string` prop. Bolt path stays procedural; only the inner-glow color tints. The white hot core stays white (real lightning is hot). Halo + afterglow blend toward `tint`.
- `components/system/TVTimerArc.tsx`, `components/system/TimerRing.tsx` — `max` defaults derived from `lockInCeremonyFor(themeKey).duration` rather than hardcoded 20.
- `lib/hooks/useTimer.ts` — `durationS` default derived from theme.
- `lib/ai/prompts.ts` — "20 seconds" → templated. Claude prompt is generated with the duration in effect for the theme that's active when the category is being authored. A question generated in April (20s prompt) and played in May (25s timer) produces marginal "easier than designed" drift, not a correctness bug. No persisted-per-question duration field is needed for v1.
- `lib/hooks/useAnswerSubmit.ts` — exposes server-confirmed signal (currently optimistic). Phone bolt fires only when this resolves.
- `components/tv/TVQuestion.tsx` — bottom region swap: renders `<PileTiles>` (existing) when `marquee === false`, `<TVScoreboardMarquee>` when `true`.
- `components/tv/TVStateMachine.tsx` — `durationS: 20` becomes theme-derived. Reveal state pauses up to 3s for ceremony queue drain.
- `app/(player)/room/[code]/page.tsx` — `QUESTION_DURATION_S` becomes theme-derived.
- `app/api/games/[id]/end-early/route.ts` — comment + any hardcoded 20s logic updated.
- `components/host/HostPhoneLive.tsx` — mirror renders new marquee/ceremony when active theme is May.
- Host admin / theme picker — block mid-game theme changes (server-side validation + UI).

---

## Data flow

```
phone tap on AnswerCard
  ↓
useAnswerSubmit → POST /api/answers (server validates timing)
  ↓
server: write to DB → emit lock-in broadcast (existing Supabase realtime channel)
  ↓
(two consumers in parallel)

  PHONE                         TV
  -----                         --
  receive 200 OK                receive broadcast
  ↓                             ↓
  PlayerLockInBolt fires        TVLockInCeremony.enqueue(event)
  (charge → bolt → flash)       ↓
  ↓                             pending count >= 2 OR
  transition to PlayerLocked    3 strikes in last 1.5s?
                                ↓                 ↓
                                yes: storm mode   no: calm mode
                                ↓                 ↓
                                strike in place   pull chip to center
                                ↓                 ↓
                                Lightning.fire(   Lightning.fire(
                                  tint=color,       tint=color,
                                  aim=chip.x        aim=center
                                )                 )
                                ↓                 ↓
                                thunder beat      thunder beat (loud)
                                                  ↓
                                                  chip returns to sort position
```

**Resilience layers:**

- TV subscribes to lock-in broadcasts. Supabase realtime is best-effort.
- TV also polls `/api/games/:id/locks` every 3s, diffs against ceremony-played set. Any missed broadcast → fires ceremony retroactively (storm-mode appropriate). **Every lock-in gets its ceremony, even if delayed.**
- Broadcast dedupe by lock-in event id (idempotent firing).
- Stale broadcasts (different question_id than current) discarded.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Scope of feature | May/Storm theme only | Brandon: lightning is the storm theme's signature; don't dilute it. Other themes unchanged. |
| Question timer | 25s (May only) | Customer ask. AI prompt also flips to 25s for May-themed generation. |
| Bottom strip layout | Auto-scrolling marquee | Replaces today's lock-in pile (May only). |
| Marquee sort | Score descending, join-order tiebreak | Rivalry feel. Leader most visible. |
| Marquee visibility | During live questions only (May) | Lobby, intermission, reveal have their own moments. |
| Transit visual | Lightning (reuse existing `Lightning.tsx`) | Highest brand cohesion; lowest cost (existing component); existing thunder audio. |
| Per-player bolt tint | Yes — player color blended into halo + afterglow | Recognizably the player's strike. White hot core preserved. |
| Speed bonus threshold | Lock < 5s remaining | Unchanged window — easier to earn on the new 25s clock. |
| `+SPD` badge visibility | Public on TV chip during strike | Bar-trivia bragging rights. |
| Mode switching | Auto (calm/storm by load) | Storm metaphor naturally absorbs many simultaneous strikes. |
| Ceremony guarantee | Every lock-in plays, no exceptions | Brandon's hard rule. Late > silent. |
| Reveal coordination | Pauses up to 3s for queue drain; strikes beyond 3s overlay reveal | No player loses their ceremony. |
| Phone ceremony timing | Plays only after server confirm | DB is source of truth. ~150-300ms perceived latency is acceptable. On slow network, phone shows a brief "locking in…" state during the wait; if confirm doesn't arrive within ~3s, surface a retry hint without playing the ceremony. |
| Phone audio | None — haptic + visual only | 30 phones × thunder = noise pollution. |
| Theme-mid-game changes | Forbidden | Mid-question theme switch would break in-flight ceremonies. Server + UI both block. |
| Pinned theme triggers | Yes — themeKey is the trigger, not the calendar | If host pins May in July, the ceremony plays. Cleanest mental model. |
| TV missed broadcast | 3s poll catches it, fires retroactively | Resilience layer for Supabase drops. |
| Reduced motion | Per-device (phone respects player's; TV respects TV's) | TV is a shared display — should honor its own preference, not any individual player's. |
| Long names | Truncate to 12 chars + ellipsis | Keep chips compact. |
| Color collisions | Accept (name on chip disambiguates) | Palette is 10 colors; collisions inevitable at 30 players. Stable per-player color matters more than uniqueness. |

---

## Edge cases (handling)

### Lock-in patterns

| Pattern | Behavior |
|---|---|
| Trickle (≤1/sec) | Calm mode. Each chip pulls to center, gets full spotlight. |
| Stampede (10+ in 2s) | Storm mode. All chips light up in place, simultaneously. Thunder rolls. |
| Bimodal (cluster early, cluster late) | Storm during clusters, calm between. |
| Last-second rush | Storm mode. Reveal waits up to 3s for drain; strikes beyond 3s overlay reveal. |
| Single fast lock at T+0.5 | Calm mode. Dramatic loud thunder. |
| Single late lock at T+22 | Calm mode. Reveal pauses to let it land. |
| Zero locks | No event. Reveal handles "no answers" normally. |

### Network / state

| Case | Handling |
|---|---|
| Broadcast arrives >3s late | Still plays ceremony. Late > silent. |
| TV misses broadcast entirely | 3s poll catches it. Fires retroactively in storm-mode flavor. |
| Player reconnects with already-registered lock | Phone shows PlayerLocked directly. TV ceremony already played (or pending in queue). |
| Offline player locks (queued, sends on reconnect) | Server treats normally. Phone bolt fires when server confirms (after reconnect). |
| TV browser refresh mid-game | Existing rehydrate restores marquee state. Any missed ceremonies fire on next poll. |
| Duplicate broadcast | Dedupe by lock-in id. Ceremony fires once. |
| Stale broadcast (prior question) | Discard by question_id filter. |
| Server rejects lock (timer just expired) | Phone gets 4xx, no ceremony fires. Player sees "didn't make it" message. |

### Marquee mechanics

| Case | Handling |
|---|---|
| Chip mid-strike when reveal hits | Strike completes; reveal pauses up to 3s. |
| Mid-question player join (if possible) | Chip appended at end (lowest score). |
| Host kicks player mid-question | Chip fades out on next render. |
| Score change mid-question (manual adjust) | Marquee re-sorts on next reveal, not live. |
| Chip target off-screen in storm mode | Auto-scrolls chip into view for the strike, then resumes. |

### Visual / accessibility

| Case | Handling |
|---|---|
| `prefers-reduced-motion` on phone | Smaller bolt, no strobe flash. Lightning component already has `LegacyFlicker` fallback. |
| `prefers-reduced-motion` on TV | Marquee scroll slows / pauses on hover. Lightning falls back to soft glow. |
| Long name (>12 chars) | Truncate "CHRISTOPHER" → "CHRIS…" on chip. |
| Color collision | Accept; name disambiguates. |
| TV audio muted | Visual stands alone. Thunder is enrichment. |
| Screen reader user | `aria-live` region on marquee announces "Mark locked in" |
| TV resolution variance | Marquee chip count responsive (4-7 visible based on width). |

---

## Performance

- **Marquee:** 30 chips — no virtualization needed. CSS transforms for scroll (cheap on the GPU).
- **Simultaneous bolts:** cap concurrent rendered bolts at 8. If more pending, stagger by ~80ms. Still feels like a storm; doesn't drop frames on a Chromecast.
- **Existing `MAX_STRIKES_PER_MINUTE` rate cap:** verify allows a 30-strike burst within 2s. If too restrictive for storm mode, raise the cap when `themeKey === "may"` and a question is live.
- **Animation cleanup:** all RAF loops + audio contexts torn down on question end and component unmount.
- **Pre-production check:** test on actual Chromecast / HDMI stick before merge.

---

## Testing

### Unit

- `tests/unit/lockInCeremony-theme.test.ts` — registry returns correct config per themeKey; non-May returns DEFAULT.
- `tests/unit/marquee-sort.test.ts` — score desc + join tiebreak; stable when scores tie; reorder on score change.
- `tests/unit/ceremony-mode-switch.test.ts` — calm/storm decisions across lock-in patterns.
- `tests/unit/ceremony-queue.test.ts` — every lock-in eventually plays, no events dropped.
- `tests/unit/timer.test.ts` — existing tests updated for theme-derived duration.

### Component

- `tests/component/TVScoreboardMarquee.test.tsx` — renders correct chips, scroll, reduced-motion behavior.
- `tests/component/TVLockInCeremony.test.tsx` — bolt fires with correct tint, +SPD badge for sub-5s locks.
- `tests/component/PlayerLockInBolt.test.tsx` — bolt fires on server confirm signal, not on tap alone.

### E2E

- `tests/e2e/may-lightning-ceremony.spec.ts` — full flow with May theme: tap → server confirm → bolt on phone + TV → chip in marquee animates.
- `tests/e2e/non-may-unchanged.spec.ts` — January/house theme: no marquee, no ceremony, 20s timer, lock-in pile intact (regression guard).
- `tests/e2e/full-game.spec.ts` — existing test updated for theme variants.
- `tests/e2e/auto-start-on-reveal.spec.ts` — verify reveal pause for ceremony queue.

### Production validation

- `scripts/full-flow-prod.mjs` extended to run twice: once with May theme, once with a non-May theme. Both must pass before PR is marked ready (Brandon's standing rule).
- Production check on Chromecast / actual TV before Heather's go-live.

---

## Rollout

- All work on `fix-regenerate-picks-and-dups` branch (current branch).
- PR with `full-flow-prod.mjs` green for both May and non-May themes before merge-ready.
- **Theme-gated feature:** instant rollback by switching night's theme away from May.
- **Emergency override:** `?theme=house` URL flag for in-session fallback if ceremony misbehaves live.
- Heather goes live today (2026-05-27). May ends in 4 days. After June 1, calendar moves to whatever the June theme is (no ceremony). If Heather pins May, ceremony persists.

---

## Open questions for plan

(None — all product decisions locked.)

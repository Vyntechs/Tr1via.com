# Realtime Freshness Watchdog — Design Spec

**Date:** 2026-05-28
**Status:** Draft for Brandon's review
**Scope:** ONE problem only — the host-screen freeze where the live connection silently died after the laptop slept, and only fully quitting Chrome recovered it.

---

## Plain-English summary (read this first)

At the first host's show the host laptop went to sleep, and when it woke the live connection became a "dead line that still looks connected" — both ends thought they were fine, but nothing got through. The screen froze for 3.5 minutes (proven in the data: a 215-second gap where no host click reached the server). The only thing that fixed it was fully quitting and reopening Chrome, which forced a brand-new connection.

This fix makes the host's laptop do that automatically. It watches whether live updates are actually arriving (instead of trusting the "connected" light), and if they stop — or if it notices the machine just woke from sleep — it throws away the dead connection and builds a fresh one in about a second, showing a small "Reconnecting…" note while it works. It never reloads the page, and a player's answers and scores are never at risk.

It runs **only on the host screen**, where the freeze actually happened. Players' phones and the venue TV are not touched. Because the heavy part runs on the single host laptop, it is safe no matter how many players are in the room.

---

## In scope / out of scope

**In scope**
- Detect and auto-recover the host's silently-dead live connection (the zombie WebSocket after sleep/wake).
- A small, calm "Reconnecting…" indicator on the host during recovery.

**Out of scope (explicitly NOT this work)**
- The Molds setup bug, the regenerate-wipes-picks bug, the migration-file bookkeeping, the TV canvas rewrite, the systemic "broadcast-everywhere" rethink. None of these are touched here.
- Auto-reloading the page (rejected — see "Recovery UX").
- Player-phone and TV transport rebuilds (phones didn't exhibit the freeze; YAGNI — revisit only if it ever appears there).

---

## Root cause (confirmed in code + data)

`lib/hooks/useRoom.ts` is the single hook every surface uses for live state. It already has **three** defenses against a dead connection, and all three share one blind spot:

1. **Focus/online revalidate** — `useRevalidateOnFocus` bumps `revalidateTick` on `visibilitychange→visible` / `online` (`useRoom.ts:130`).
2. **15s heartbeat** — a blind timer that re-bootstraps every 15s (`useRoom.ts:150-155`).
3. **Channel-error counter** — bumps `reconnectCounter` on `CHANNEL_ERROR / TIMED_OUT / CLOSED`, throttled to once per 2s (`useRoom.ts:137-139, 380-393`).

All three feed one effect dependency array (`useRoom.ts:638`); any bump tears down and re-runs `bootstrap()`.

Three facts make these insufficient for the freeze:

- **They trust connection *status*, not data *freshness*.** A zombie socket reports `SUBSCRIBED` while delivering nothing. None of the three asks "have we actually *received* anything lately?"
- **Re-subscribing reuses the dead socket.** All recovery paths call `supa.removeChannel()` + re-`.subscribe()` on the **same** shared WebSocket (`useRoom.ts:487-489, 539-541`). The singleton client holds one socket (`lib/supabase/client.ts`); re-subscribing on a dead transport does not heal it. Only dropping the transport and building a new one does — which is exactly what quitting Chrome did.
- **Foreground sleep fires no event.** A laptop that sleeps with the tab already in front fires neither `visibilitychange` nor `online` on wake, so layer 1 structurally misses the host's exact case.

## The fix — a 4th layer, host-only

Add a **freshness watchdog** to `useRoom`, active **only on the host surface**. (Host call sites omit `deviceId`; players pass it — `useRoom.ts:114-124`. So `deviceId === undefined` cleanly identifies the host with no new prop.)

**1. Track freshness.** Stamp `lastMessageAt = Date.now()` on every received realtime event — both broadcast handlers (`useRoom.ts:397-482`) and every `postgres_changes` merge handler (`useRoom.ts:549-625`). One small `markFresh()` call per handler.

**2. Detect death two ways.** A 1-second `setInterval` checks:
- **Stale:** `now - lastMessageAt > STALE_MS` (90s) *while* channels still claim `SUBSCRIBED`. Set above the 64s longest legitimate between-question pause seen in show data so a normal lull never trips it; the sleep-gap check is the fast path.
- **Sleep-wake gap:** the same tick compares wall-clock delta to its expected 1s interval; a delta far larger than expected (e.g. >5s) means the machine slept — treat wake as a recovery trigger. This catches the foreground-sleep case layer 1 misses.

**3. Hard recovery (the new behavior).** On a trigger, drop the transport and rebuild — `supa.realtime.disconnect()` then reconnect — forcing a brand-new socket. The central `RealtimeClient` re-joins its registered channels on the new socket (the host live console's extra channels included); then bump the effect to re-`bootstrap()` so any state missed during the dead window is re-fetched over HTTP. This is the one thing the existing three layers do not do.

**4. Coordinate, don't collide.** One coordinated recovery path with an in-flight lock + cooldown so the rebuild does not double-fire with the 15s heartbeat or the channel-error counter (which will themselves fire `CLOSED` callbacks as the socket drops). Reset the heartbeat after a successful rebuild. Add small randomized **jitter** before the rebuild — harmless at one host, and future-proofs against a stampede if the layer is ever extended to phones.

**5. Recovery UX (Option A — matches every comparable product).** Surface a calm "Reconnecting — your game is safe" state via the existing `channelHealth` → ConnectionRibbon path (`lib/realtime/channelHealth.ts`). **Never auto-reload.** Optionally a manual "Reload" button as a last-resort escape hatch the host chooses to press. Auto-reload is a documented anti-pattern (web.dev, Nielsen Norman, WebSocket.org) and a plain refresh did not fix the freeze that night anyway.

## Why it's safe at any player count

- **Gameplay can't be harmed.** Every game action — join, **lock answer**, reveal, resolve, adjust, end — is an HTTP POST, fully independent of the realtime socket (`useAnswerSubmit.ts:123 → /api/answers`, etc.). Answers also persist to `localStorage` and retry. The socket is receive-only. Rebuilding it cannot lose an answer or corrupt a score.
- **REST and auth untouched.** `realtime.disconnect()` only affects the WebSocket; `supabase.from()` and `supabase.auth` ride separate HTTPS paths.
- **Scale-free by construction.** The heavy operation runs on the **single host** — always exactly one, regardless of crowd size (O(1), not O(N)). Players' phones keep their existing three layers and answer durability, byte-for-byte unchanged, so this change cannot regress the player side at any count. The TV uses `useTVRoom` + its 4s poll, also untouched.

## Approaches considered

- **Chosen — host-only freshness watchdog + transport rebuild.** Smallest blast radius, directly fixes the proven incident, scale-free.
- **Rejected — re-subscribe only (no transport drop).** Doesn't heal a zombie socket; it's what the current layers already do.
- **Rejected — auto-reload the page.** Anti-pattern; didn't fix it that night; risks a reload loop on a live host screen.
- **Rejected (for now) — apply transport rebuild to all surfaces.** Phones didn't exhibit the freeze and have answer durability; adding N-client transport rebuilds invites storm/blast-radius risk for no proven need. Revisit only if the zombie appears on phones.

## Testing & validation

- **Unit (vitest):** `markFresh` stamps on each event type; stale threshold triggers exactly one rebuild; sleep-gap triggers a rebuild; cooldown/in-flight lock prevents double-fire with heartbeat + channel-error; the layer is inert when `deviceId` is defined (player surface).
- **Load (`scripts/full-flow-prod.mjs`, `SMOKE_PHONES=30/60/100 SMOKE_REALTIME=1`):** confirm player-side request rate is flat/unchanged by this PR across the range, and a forced host rebuild does not disturb any phone. Flat across the range = scale-free in practice.
- **Manual repro:** drive the host live console on a real laptop, sleep it mid-game, wake it; confirm auto-recovery < ~2s with the "Reconnecting…" note and no page reload. Compare against `main` (which stays frozen).

## Files touched

- `lib/hooks/useRoom.ts` — the watchdog layer (host-gated), `markFresh` calls, coordinated recovery path.
- `lib/supabase/client.ts` — only if a small helper to drop+rebuild the transport is cleaner than calling `realtime.disconnect()` inline.
- Possibly `lib/realtime/channelHealth.ts` / ConnectionRibbon — a "reconnecting" state if not already expressible.
- Tests under `tests/unit/`.

## To verify during implementation

- Confirm the installed `@supabase/realtime-js` version's `disconnect()`/`connect()` behavior: that reconnect re-joins all registered channels (ours + the host console's). The design will **explicitly** re-establish our channels rather than rely solely on undocumented auto-resubscribe.
- Confirm a clean monotonic source for the sleep-gap check (interval-delta is sufficient; no new dependency needed).

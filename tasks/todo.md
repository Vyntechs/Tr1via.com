# Task: Magic Welcome moment for new player joins

Re-plans: 0/3

## Goal
Three surfaces (TV, host live console, joining player's phone) react in sync to a new player joining a night — slide-in name tile + gold glow stinger + two-note chime + per-player color + sparkle trail for the first 5 joiners. Closes the gap where the TV currently polls for new players every 4s by adding a `player-joined` broadcast.

## Plan

1. **Server: emit `player-joined` broadcast** in `app/api/players/route.ts`
   - After the players upsert, look up `nights.room_code` from the night row already fetched above.
   - Call `broadcastToRoom(roomCode, "player-joined", { playerId, displayName, joinedAt, colorKey })` — best-effort try/catch.
   - Extend `RoomEventName` union in `lib/api/broadcast.ts` to include `"player-joined"`.
   - Allow `colorKey` to be derived server-side using the same deterministic hash as the client (so the color in the broadcast matches what each surface renders independently).

2. **Per-player color helper** at `lib/player/playerColor.ts`
   - Export `PLAYER_PALETTE` (10-12 hex colors that read well on dark themes).
   - Export `playerColorKey(playerId): number` and `playerColorHex(playerId, themeKey?)` — deterministic FNV-1a hash of the playerId modulo palette length.
   - Pull complementary colors that don't collide with `accent`/`pop` of any theme; use a "name color" palette designed for the welcome name tile.

3. **Web Audio chime** at `lib/audio/welcomeChime.ts`
   - Lazy singleton AudioContext (created on first `playWelcomeChime()` call so it ties to the user gesture from join tap on iOS).
   - Two-note rising major third (E5→G#5), sine with triangle overlay, ADSR 20/100/0/220, second note +80ms, total ~380ms.
   - -3dB below media peak via gain node.
   - Reuse one AudioContext across calls; gracefully no-op when audio context creation fails.

4. **Shared welcome overlay** at `components/system/WelcomeOverlay.tsx`
   - Props: `{ name, color, isHeroEntrance, prefersReducedMotion, position?, onComplete? }`
   - Slide-in tile from bottom-right by default; 360ms ease (`cubic-bezier(0.05, 0.7, 0.1, 1.0)`), hold 2.5s, 200ms exit. Subtle scale overshoot 0.96→1.02→1.0.
   - Soft gold glow stinger on leading edge at 280ms apex via `var(--accent)`.
   - Sparkle trail (pure CSS particles) when `isHeroEntrance`.
   - Reduced-motion: instant-appear + hold + instant-exit, no scale/sparkle.
   - Scoped `<style>` block following `TVSectionComplete.tsx` template.

5. **`useRoom` listens for `player-joined`** in `lib/hooks/useRoom.ts`
   - Extend `BroadcastTag` union to add `"player-joined"` with `displayName`, `playerId`, `colorKey`, `joinedAt`.
   - Wire `.on("broadcast", { event: "player-joined" }, ...)` to set `lastBroadcast` and increment a join counter that the consumer reads.
   - No `refreshLiveState` — players are added by postgres_changes already. The broadcast is purely the wake-up tag.

6. **`useTVRoom` listens for `player-joined`** in `lib/hooks/useTVRoom.ts`
   - Extend `TVBroadcast` union the same way.
   - Wire `.on("broadcast", { event: "player-joined" }, ...)` to set `lastBroadcast` AND immediately `fetchSnapshot()` so the players list refreshes before the 4s safety poll.

7. **TVLobby renders the welcome overlay** in `components/tv/TVLobby.tsx`
   - Accept new prop `welcomeEvent?: { playerId; name; color; joinIndex } | null`.
   - Mount `<WelcomeOverlay>` with the recent join. Use joinIndex to decide `isHeroEntrance` (first 5 joins = true).
   - Color the topmost JUST-JOINED roster entry with the player's color when their id matches the welcome event.

8. **Wire TVStateMachine + host console** in `components/tv/TVStateMachine.tsx`
   - Accept a new prop `lastWelcomeEvent` and pass through to `TVLobbyView` → `TVLobby`.
   - `app/tv/[code]/page.tsx` derives a welcome event from `useTVRoom`'s `lastBroadcast.event === "player-joined"` plus the snapshot's players list to look up join order.
   - `HostLiveConsoleClient.tsx` derives the same from `useRoom`'s `lastBroadcast`.

9. **PlayerLobby fires the joining player's own welcome moment** in `app/(player)/room/[code]/page.tsx`
   - On first mount with `me` resolved, fire color flash + chime + (Android haptic if `navigator.vibrate` exists).
   - Use `sessionStorage` keyed on `nightId:playerId` so the welcome fires once per join (not every navigation back to lobby).
   - Color-flash overlay rendered briefly above the lobby.

10. **Acceptance test additions**
   - Unit test for `playerColorHex` determinism + range.
   - Unit test for `playWelcomeChime` no-op on missing AudioContext (jsdom).
   - Run `npx tsc --noEmit` and `npx vitest run` — must be clean.
   - Run full-flow-prod.mjs as a smoke (just to prove nothing regressed in the join path).

11. **Open PR**
   - Title: `feat(welcome): magic welcome moment for new player joins`
   - Body: plain-English what changed + 3 things Brandon should eyeball visually.

## Out of scope
- No DB schema changes; color is derived client+server-side deterministically.
- No new audio file (Web Audio synthesizes).
- iOS haptic hack — explicitly skip per brief.

## Files I'll touch
- `lib/api/broadcast.ts` (union add)
- `app/api/players/route.ts` (broadcast emit)
- `lib/hooks/useRoom.ts` (player-joined handler + BroadcastTag union)
- `lib/hooks/useTVRoom.ts` (player-joined handler + TVBroadcast union)
- `components/tv/TVLobby.tsx` (welcome overlay + color name)
- `components/tv/TVStateMachine.tsx` (prop drilling)
- `app/tv/[code]/page.tsx` (welcome event derivation)
- `app/host/live/[nightId]/HostLiveConsoleClient.tsx` (welcome event derivation)
- `components/host/HostLiveConsole.tsx` (prop drilling)
- `app/(player)/room/[code]/page.tsx` (joining player welcome moment)
- `components/system/index.ts` (export WelcomeOverlay)

## Files I'll create
- `components/system/WelcomeOverlay.tsx`
- `lib/audio/welcomeChime.ts`
- `lib/player/playerColor.ts`
- `tests/unit/playerColor.spec.ts`
- `tests/unit/welcomeChime.spec.ts`

## Risk
- Broadcast bypasses RLS (server-side, service role) — safe.
- The `player-joined` event includes display_name, which other listeners on the channel will receive — same surface as existing reveal broadcasts already do (it's a public room channel).
- Audio gesture gating: iOS requires user gesture; join page is the gesture, but the joining player lands on /room AFTER the gesture's promise resolves. The audio creation will happen post-redirect — could be silent on iOS. Mitigation: fire chime inside the join page's success handler, OR cache "audio unlocked" flag on the join click and create context on first room mount. Try the gesture-on-join approach; if not viable, fall back to chime only on subsequent surfaces (TV+host) and rely on color flash on the joining player's phone.

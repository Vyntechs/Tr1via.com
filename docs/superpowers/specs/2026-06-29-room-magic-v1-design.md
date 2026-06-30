# Room Magic v1 Design

**Status:** approved packet, design spec
**Date:** 2026-06-29
**Packet:** Room Magic v1: Signals, Not Chat

## 1. Goal

Room Magic v1 makes Heather's Classic feel more alive without changing how Classic works.

Players get small, bounded ways to signal emotion at safe moments. The TV turns those signals into shared room atmosphere. Phones confirm that the room received the signal. The host does not moderate, score, read, approve, or manage the signals.

The product promise is:

> Every phone feels connected to the room, and the TV feels like the room is smiling back.

## 2. Doctrine

Room Magic is not chat. It is not social media. It is not a second game system. It is atmosphere.

Rules:

- Reactions are cosmetic only.
- Reactions never change score.
- Reactions never interrupt answering.
- Reactions never expose free text.
- Reactions never require host moderation in v1.
- Reactions happen only at safe moments.
- Heather's Classic remains recognizable and familiar.
- Existing hosts do not get surprise behavior.

## 3. Recommended Shape

Use the existing realtime room channel and live-state surfaces. Do not create a full social subsystem.

V1 should ship as an optional overlay around Classic:

- a per-night or host-level Room Magic setting
- bounded player reaction buttons after reveal
- lightweight "sent to the room" phone feedback
- a TV atmosphere overlay that aggregates room signals
- optional lock-in energy polish using existing lock-in state
- rate limits that prevent spam

This packet should not include profiles, badges, free text, moderation queues, public feeds, league identity, or permanent social history.

## 4. Product Moments

### 4.1 Lock-In Energy

When a player answers, the phone should confirm that the answer joined the room. This is not a reaction button. It is feedback that the player's action reached the live game.

Player phone:

- After answering, the locked screen keeps the existing chosen-answer state.
- Add a short line such as "Sent to the room" or "Your answer is in the room."
- Keep the existing live lock-in count.
- Do not add new controls while a question is active.

TV:

- Keep the existing lock-in pile or marquee.
- Add or refine a room-energy treatment only if it reuses existing lock-in state.
- Do not show reaction buttons or names beyond the existing lock-in visualization.

Success:

- Waiting after lock-in feels alive.
- No one can distract the room during answering.

### 4.2 Reveal Reactions

After the answer reveal, players may send one bounded reaction for that reveal moment.

Allowed reactions:

- Applause
- Nice one
- Wow
- Brutal

Player phone:

- Reaction controls appear only on reveal screens.
- Each player can send one reaction per reveal.
- The chosen reaction gives immediate local feedback.
- The phone confirms that the signal reached the room.
- Reduced-motion users get a calm state change instead of animated bursts.

TV:

- Reactions appear as an aggregate atmosphere overlay, not a chat feed.
- Show short-lived bursts or clustered counts.
- Do not list every tap as a notification stream.
- Do not display free text.
- Do not cover the correct answer, fastest list, or host-readable content.

Success:

- Players naturally tap because it feels good.
- The TV feels collectively responsive.
- The reveal remains readable.

### 4.3 Between-Games Cheer

The code already has local-only cheer buttons between games. V1 may either leave this local or route it through the same Room Magic signal system after reveal reactions are working.

If included:

- Cheers remain bounded.
- No score impact.
- No permanent feed.
- TV may show a halftime room-energy pulse.

This is secondary to reveal reactions.

## 5. Non-Goals

Do not build these in v1:

- open chat
- free text
- player-to-player direct messages
- public profiles
- badges or achievements
- reaction-based scoring
- host moderation queues
- venue sponsor moments
- league standings
- permanent reaction history shown to players
- new game mode selection

## 6. Classic Protection

Heather's Classic must not change by surprise.

Protected behaviors:

- host-led reveal flow
- answer submission
- lock-in timing
- resolve behavior
- scoring
- leaderboard
- TV state machine
- player join flow
- host live controls
- host phone controls

Default behavior:

- Existing hosts keep the known Classic experience unless Room Magic is explicitly enabled.
- If the setting is missing or unreadable, Room Magic is off.
- If realtime signal delivery fails, the game continues normally.

## 7. Data and Transport

V1 should use best-effort realtime signals for reaction delivery.

Recommended model:

- Server receives a player reaction request.
- Server validates the player, room, reveal moment, allowed reaction, and rate limit.
- Server broadcasts a cosmetic room event on the existing `room:{code}` channel.
- TV and phones render the event if Room Magic is enabled.
- No game state depends on the reaction event.

Durability:

- Reactions do not need to be restored after refresh in v1.
- A missed reaction broadcast is acceptable.
- The source of truth for the game remains existing game tables.

Database change file:

- Add only the smallest setting storage needed to enable Room Magic safely.
- Prefer a nullable or default-off field on an existing host/night settings surface if it fits existing patterns.
- If a new table is needed, it must be additive and reversible.
- Do not store unnecessary personal data.
- Do not store free-text content.

## 8. Access and Safety

Player reactions must be accepted only from joined players in the room.

Validation rules:

- Player must belong to the night.
- Night must be open or actively running.
- Room Magic must be enabled for that night or host.
- Reaction kind must be one of the allowed bounded values.
- Moment must be valid for reaction, starting with post-reveal.
- One player can send one reaction per question reveal.
- Server ignores or rejects reaction spam.

Privacy:

- Do not collect new personal information.
- Do not expose device IDs.
- Do not expose private host data.
- Do not expose other players' answer choices.

Moderation:

- No free text means no text moderation in v1.
- Bounded reaction names must be kind and non-hostile.
- "Brutal" means "that question was hard," not criticism of a player.

## 9. UX Requirements

### Player Phone

The phone should feel personal, fast, and calm.

Requirements:

- Reaction buttons fit on small screens.
- Buttons do not hide the reveal result.
- Buttons are disabled or replaced after one tap.
- Feedback is instant even if the broadcast is still in flight.
- Network failure does not show an alarming error.
- Reduced-motion mode avoids unnecessary animation.

### Venue TV

The TV should feel collective, not busy.

Requirements:

- Reaction overlay stays clear of the answer, fact blurb, and fastest list.
- Overlay fades quickly.
- Aggregated signals are preferred over individual notification rows.
- Motion is legible from across a room.
- The overlay works on host-mirrored laptop TV and standalone TV route.

### Host

The host should not manage Room Magic in the live flow.

Requirements:

- Host can enable/disable Room Magic before or outside the live moment.
- Host live console remains calm.
- No reaction queue appears.
- No moderation duties appear.

## 10. Architecture

Suggested units:

- `roomMagic` domain types for allowed reaction kinds and moment gates.
- API route for player reaction submission.
- Broadcast payload type for room-magic events.
- `useRoom` and `useTVRoom` extensions for cosmetic room-magic events.
- Player reveal controls component.
- TV room-magic overlay component.
- Optional host/setup setting control.

Boundaries:

- Game state remains separate from room-magic state.
- Cosmetic broadcasts must not trigger heavy snapshot refreshes.
- Room Magic components should accept plain props and be testable without Supabase.
- Server validation should be separate from UI rendering.

The existing fireworks event is the closest transport pattern: cosmetic, best-effort, no game-state refresh. Room Magic should follow that pattern, with stricter server validation because players initiate it.

## 11. Error Handling

Failure behavior:

- If reaction submit fails, the player UI quietly settles.
- If broadcast fails, the game continues.
- If Room Magic setting cannot be read, treat it as off.
- If reaction payload is malformed, ignore it client-side.
- If a reaction arrives outside an allowed moment, ignore it.

No Room Magic error should block:

- answering
- reveal
- scoring
- TV state updates
- player navigation
- host controls

## 12. Verification

Implementation must prove:

- Classic works with Room Magic off.
- Existing hosts do not see changed default live behavior.
- Reaction controls appear only on reveal screens when enabled.
- A player can send only one reaction per reveal.
- Reaction spam does not create repeated TV events.
- TV renders aggregate reaction atmosphere without hiding answer content.
- Player answer, reveal, score, and leaderboard behavior are unchanged.
- Realtime failure is non-blocking.
- Reduced-motion users get a calm experience.

Test levels:

- Unit tests for allowed reaction kinds and moment gating.
- API tests for joined-player validation and rate limiting.
- Component tests for player reaction controls and TV overlay.
- E2E test for one host, TV, and two phones showing a post-reveal reaction on TV.
- Existing reveal-sync and full-game flows must remain green.

## 13. Branch and Release Strategy

Use `staging/room-magic-v1` for implementation if the first implementation touches player phone, TV, realtime, and a database setting in one packet.

Main-branch merge criteria:

- Room Magic is off by default for existing hosts.
- A preview proves the feature on a test night.
- Production database changes, if any, are additive and reversible.
- No surprise production behavior for Heather's Classic.
- No live-night deploy.

Rollback:

- Disable the Room Magic setting.
- Revert the app PR if needed.
- If a database change file was applied, it must be safe to leave in place even with the app reverted.

## 14. Open Decisions for Implementation Planning

These are implementation decisions, not product blockers:

- Whether the enable switch lives on the night setup screen or host settings first.
- Whether v1 stores reaction attempts for server-side rate limiting or uses existing answer/reveal rows plus a lightweight in-memory/window check.
- Whether between-games cheer becomes room-visible in v1 or stays local until v1.1.
- Exact TV visual style for the overlay.

Recommended defaults:

- Enable switch: night-level setting.
- Rate limiting: server-enforced, per player per question reveal.
- Between-games cheer: defer unless reveal reactions finish cleanly.
- TV style: aggregate bursts/counts, not feed rows.

## 15. Self-Review

- Completeness scan: no incomplete sections remain.
- Internal consistency: Room Magic is optional, cosmetic, and Classic-safe throughout.
- Scope check: v1 is one packet, focused on post-reveal reactions and lock-in feedback.
- Ambiguity check: non-goals, allowed moments, allowed reactions, and default-off behavior are explicit.

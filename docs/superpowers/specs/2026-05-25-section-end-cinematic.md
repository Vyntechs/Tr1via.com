# Section-End Cinematic + Jeopardy-Grid Restoration

**Date:** 2026-05-25
**Author:** Claude (paired with Brandon)
**Ships before:** Heather's go-live, Wednesday 2026-05-27

---

## Problem

The "Pick the next topic" panel currently shown after a category's last question takes Heather's question-picking control away. After tapping a topic, the system auto-starts that topic's lowest-points unplayed question — she can't pick by point value. Heather is going to feel this and say something on Wednesday.

It's not all bad, though: the section-end screen has a sleek modern moment that the old grid lacked. The original complaint that triggered its addition — "After there's no more questions in a section, why does it just sit there?" — was real. The grid sat there silently, no sense of accomplishment.

## Goal

Heather picks **any remaining question by any remaining point value** at all times — same Jeopardy grid she's used to. *And* the moment a topic finishes, the room gets a cinematic "Section Complete" beat that feels earned. Both. No half-measures.

## Non-goals

- Visual redesign of `TVGrid` itself. It already renders played cells as "dashed-out and struck through" — that's the cleared-row look.
- Player phone changes. The cinematic is a TV-and-host-laptop moment only.
- Touching the lobby, intermission, or finale flows.

---

## Design

### Behavior

When the host resolves the last unplayed picked question of a category:

1. **Sticky reveal** stays on screen as today — audience reads the answer, host reads the room. The state machine remains unchanged here.
2. The moment the state machine *would* render the picking surface — i.e. the host has tapped **"Pick next →"** (sets `hostAdvanced=true`), or on the audience TV when the sticky reveal naturally clears — a **Section Complete overlay** mounts on top of the grid:
   - "SECTION COMPLETE" eyebrow.
   - The cleared topic's name in display weight, painted in the topic's category color.
   - Scale-in (~250 ms), hold at full opacity (~1.3 s), fade out (~250 ms). Total beat: **~1.8 s**.
3. As the overlay fades, the **Jeopardy grid** is the surface underneath — same one used at the start of the game. The just-completed topic's row is rendered with the existing "played" cell treatment (struck through / dashed-out across all 7 cells).
4. The host can tap any unplayed cell in any remaining topic to launch the next question, exactly like the start-of-game grid pick.

On the host laptop bottom strip:
- During the overlay: `"Section complete — [Topic] cleared."` (replaces the current `inSectionPicker` caption).
- After: `"Tap a cell to reveal the next question."` (existing copy).

The audience TV plays the same overlay; rows underneath remain inert (no click handler) — same shape as today.

### Surfaces removed

- `components/tv/TVSectionEndedPicker.tsx` — deleted. Export removed from `components/tv/index.ts`.
- `TVStateMachine`'s "section ended → render `TVSectionEndedPickerView`" branch — deleted. The post-resolve `picking` state always renders `TVGridView` now.
- `HostModeContext.inSectionPicker` flag in `lib/host/deriveHostMode.ts` — deleted. Tests for it in `tests/unit/deriveHostMode.test.ts` are updated to assert the grid is the canonical picker.

`getRemainingTopics()` is retained — it's still useful to the celebration hook for resolving the topic name + color from the question that just completed.

### Surfaces added

#### `components/tv/TVSectionComplete.tsx`

Full-bleed cinematic overlay component. Pure props, no fetches.

```ts
export interface TVSectionCompleteProps {
  /** Display name of the topic that just cleared. */
  topicName: string;
  /** Hex from categories.color; falls back to categoryColor(topicName) internally. */
  color?: string | null;
  /** When provided, overrides the natural exit timer — used by /dev/tv to hold the frame for screenshotting. */
  staticHold?: boolean;
}
```

Layout:
- Absolute-positioned over the parent `TVStage`, `z-index` above the grid but below the header/footer chrome (so the room code etc. stay legible).
- Semi-opaque backdrop in the topic color (RGB color + alpha ~0.85), so the cleared grid row is still faintly visible behind it.
- Center stack: small "SECTION COMPLETE" eyebrow (same tokens as TV headers), large topic name (`Display` weight 700, ~96 px), thin animated underline in topic color.
- Animations via plain CSS keyframes — no new dependency. The component manages its own enter/exit; mounting begins enter, parent unmounts after the timer.
- Respects `prefers-reduced-motion`: holds the overlay for the same 1.8 s but skips scale; opacity fade only.

#### `lib/hooks/useSectionCompleteCelebration.ts`

```ts
export interface SectionCompleteCelebration {
  topicName: string;
  color: string | null;
  /** The question id that triggered this celebration. */
  triggeredByQuestionId: string;
}

export function useSectionCompleteCelebration(
  snapshot: TVSnapshot | null,
  hostAdvanced?: boolean,
): SectionCompleteCelebration | null;
```

**Trigger predicate** — all of:
1. `snapshot.currentGameId` resolves to a game in `state: "live"`.
2. There is no `liveQuestion` right now (we're in the picking-surface window).
3. On the host laptop, `hostAdvanced === true`. On the audience TV, the snapshot's sticky-reveal pointer has cleared (which is the same condition that currently triggers the picker today). The hook handles both — host callsites pass `hostAdvanced`; audience callsites omit it (defaults to `false`) and the hook falls back to detecting "no sticky reveal."
4. The most-recently-finished picked question (sorted by `finishedAt` desc) belongs to a category whose remaining-unplayed-picked-question count is now **zero**.
5. The game still has at least one OTHER category with unplayed picked questions — i.e. `canEndGame` is false.
6. This question id has not already triggered a celebration this mount (tracked via `useRef<string | null>`).

**Behavior on trigger:**
1. Set state to `{ topicName, color, triggeredByQuestionId }`.
2. Record the question id in the ref so re-renders don't re-fire.
3. Start a 1.8 s `setTimeout` that clears state back to `null`.
4. While state is non-null, return it. Otherwise return `null`.

**Cleanup:** clear the timer on unmount.

### Wiring

Both TV callsites mount the overlay alongside the state machine. The state machine itself stays pure and unaware of the celebration:

- `components/host/HostLiveConsole.tsx` — call the hook, render `<TVSectionComplete>` inside the same stage frame the state machine renders into, on top.
- `app/tv/[code]/page.tsx` — same shape, no host props.

The hook reads the snapshot directly, so both callsites stay in lockstep with no prop drilling beyond what already exists.

### Visual reference (text mockup — illustrative; real board is 6 cols × 7 rows)

```
       FRAME 1 — Section Complete overlay (~1.8 s)
┌────────────────────────────────────────────────────┐
│  GAME 1 · LIVE              9 OF 42 ANSWERED       │
│                                                    │
│              ┌──────────────────────┐              │
│              │   SECTION COMPLETE   │              │
│              │                      │              │
│              │    Martial Arts      │              │
│              │    ────────────      │              │
│              └──────────────────────┘              │
│                                                    │
│     (grid faintly visible behind in topic color)   │
│                                                    │
│  TR1VIA.COM · YU5·JF3                              │
└────────────────────────────────────────────────────┘
              ↓  overlay fades out                  
       FRAME 2 — Grid as picker, completed row cleared
┌────────────────────────────────────────────────────┐
│  GAME 1 · LIVE              9 OF 42 ANSWERED       │
│  ┌────┬────┬────┬────┬────┬────┬───────────────┐   │
│  │SKRT│KYLE│GIRL│WORK│MART│ +6 │  leader       │   │
│  │    │BUSH│BAND│BOOT│ART │    │  Devon · 320  │   │
│  ├────┼────┼────┼────┼────┼────┤               │   │
│  │ 100│ 100│ 100│ 100│╳100│ … │               │   │
│  │ 200│ 200│╳200│ 200│╳200│ … │  Board left   │   │
│  │ 300│ 300│ 300│ 300│╳300│ … │  33 of 42     │   │
│  │ 400│ 400│ 400│ 400│╳400│ … │               │   │
│  │ 500│ 500│ 500│ 500│╳500│ … │               │   │
│  │ 600│ 600│ 600│ 600│╳600│ … │               │   │
│  │ 700│ 700│ 700│ 700│╳700│ … │               │   │
│  └────┴────┴────┴────┴────┴────┴───────────────┘   │
│  TR1VIA.COM · YU5·JF3  Tap a cell to reveal next   │
└────────────────────────────────────────────────────┘

   ╳ = cleared (existing dashed-out / struck-through style)
   "+6" stands in for the 6th category column trimmed for ASCII width
```

---

## Edge cases

| Case | Behavior |
|---|---|
| Last question of the last category in the game | Celebration does NOT fire. `canEndGame` becomes true; existing End Game flow takes over (leaderboard → intermission or finale). |
| Refresh during the 1.8 s overlay, OR refresh shortly after | On remount, the hook re-evaluates from snapshot. If the section-completing question is still the most-recently-finished AND no new question has been started, the celebration replays. **Accepted trade-off:** refreshes during the picking gap are rare; replaying a 1.8 s flourish is benign and not gameplay-affecting. Persisting "already celebrated" question ids in sessionStorage could suppress the replay; deferred unless Heather hits it. |
| Host double-taps "Pick next →" | Celebration ref is keyed by question id; only the first tap triggers the overlay. No double-fire. |
| Network blip clears the snapshot's `reveals` mid-overlay | The overlay's exit timer runs independently of the snapshot. Overlay finishes its 1.8 s and unmounts cleanly. |
| Skipped Game 2 (Prisons in review) | Hook only runs in `live` games. Skipped/empty games never trigger it. |
| Audience TV that joins mid-celebration | Catches the overlay in progress — the hook fires on first eligible-resolve detection regardless of when the page mounted. They see the tail end and that's fine. |
| Reduced-motion preference | Overlay still shows full 1.8 s; the scale/bloom animations no-op. |

---

## Testing

### Unit

`tests/unit/useSectionCompleteCelebration.test.ts` (new):
- Fires when the latest resolve completes a category and others remain.
- Does NOT fire when the latest resolve completes the LAST category in the game.
- Does NOT fire twice for the same resolved question id.
- Auto-clears after 1.8 s (use fake timers).
- Returns null while no eligible resolve has happened.

`tests/unit/deriveHostMode.test.ts` (update):
- Drop the 3 assertions that pinned `inSectionPicker: true` (the field no longer exists).
- Add: in the same "category just ended, others remain" snapshot, `mode === "picking"` and `canEndGame === false`. (The picking surface IS the grid now.)

`tests/unit/TVStateMachine.*.test.*` (audit + update if any exist):
- Any test that asserted `TVSectionEndedPicker` rendering for a section-just-ended snapshot must flip to asserting `TVGrid` instead.

### Manual smoke

Drive a real-flow preview using the existing `scripts/full-flow-prod.mjs` pattern, point it at a preview deploy. Run game 1, watch:
- After the 7th question of any category, host taps Pick next.
- Overlay appears, fills the stage with topic color, holds for ~1.8 s, fades.
- Grid is now visible with that topic's entire row in the cleared "played" treatment.
- Host can tap any cell in any remaining topic and start the next question.

Capture two screenshots — overlay at peak, grid after — and attach to the PR.

### Designer-friendly route

Add `TVSectionComplete` to `/dev/tv` gallery with `staticHold={true}` so the frame can be screenshotted for marketing or Heather walkthroughs.

---

## Files affected

| File | Change |
|---|---|
| `components/tv/TVSectionComplete.tsx` | **new** — overlay component |
| `lib/hooks/useSectionCompleteCelebration.ts` | **new** — trigger hook |
| `components/tv/TVStateMachine.tsx` | remove `TVSectionEndedPickerView` branch + helper |
| `components/tv/TVSectionEndedPicker.tsx` | **delete** |
| `components/tv/index.ts` | drop the deleted export |
| `lib/host/deriveHostMode.ts` | drop `inSectionPicker` from `HostModeContext` |
| `components/host/HostLiveConsole.tsx` | mount overlay; replace `inSectionPicker` caption with celebration caption |
| `app/tv/[code]/page.tsx` | mount overlay |
| `app/dev/tv/page.tsx` (or wherever the gallery lives) | swap `TVSectionEndedPicker` entry for `TVSectionComplete` |
| `tests/unit/deriveHostMode.test.ts` | update assertions |
| `tests/unit/useSectionCompleteCelebration.test.ts` | **new** |

---

## Build order

1. `TVSectionComplete` component + `/dev/tv` gallery entry. Visual review.
2. `useSectionCompleteCelebration` hook + unit tests.
3. Wire overlay into both TV callsites (`HostLiveConsole`, `app/tv/[code]/page.tsx`).
4. Remove `TVSectionEndedPickerView` branch and its imports from `TVStateMachine`. Audit any state-machine tests and flip section-ended assertions to expect `TVGrid`.
5. Drop `inSectionPicker` from `deriveHostMode` + update its test.
6. Update `HostLiveConsole` bottom-strip caption (celebration text while overlay is active; otherwise the existing "Tap a cell" copy).
7. Delete `TVSectionEndedPicker.tsx`, remove its export and the `TVSectionEndedTopic` type export from `components/tv/index.ts`.
8. Manual smoke on preview, capture screenshots (overlay at peak + grid after), attach to PR.

---

## Out of scope, but flagged

- Player-side persistence gaps (the 15 found earlier — `visibilitychange` + `online` refetch, `.subscribe()` status callback re-bootstrap, missed `hosts!inner` in `useRoom.ts:188-190`, localStorage queue for unsent answers). Tracked separately; this spec covers only the section-end UX.
- "Room → Game" copy rename (still parked from session 13 handoff).

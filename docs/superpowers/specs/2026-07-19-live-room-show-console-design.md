# Live-Room Show Console Design

**Status:** Approved by Brandon for written-spec review on 2026-07-19.

**Figma:** [TR1VIA — Host Command Center North Star](https://www.figma.com/design/dPbRLK2VQQ0CcxRZNadUCL)

**Mode:** Heather's Classic / Original trivia mode. This design refines the existing mode; it does not introduce a new game mode.

## Outcome

TR1VIA becomes the self-confirming live-room show console: one ordinary host can run a professional room-wide game show because one action coordinates the venue TV and every player phone, proves what arrived, and turns the result into one shared room moment.

Trivia is the first proven format. The category is live-room play.

The product must make four outcomes visible:

- **Host certainty:** Heather knows what every surface is showing without checking the laptop or guessing.
- **Player confidence:** a player knows their answer was saved and that their phone shows the current game state.
- **Shared room energy:** phones feel personal while the TV turns individual actions into a collective beat.
- **Return momentum:** the finale gives players and the venue a specific reason to return next week.

## Protected Contract

- Heather's existing Classic rules, question order, scoring, and familiar board remain unchanged.
- The board is the default host surface between questions.
- The laptop remains a complete control surface. Phone hosting is optional and may become preferred, never required.
- The private host phone never exposes correct answers or host-only evidence on the venue TV.
- Players join from the browser without accounts, app installation, or payment.
- Host actions remain explicit. AI does not reveal, score, punish, or alter live content without host review.
- Fair-play information is evidence, never an accusation or automatic penalty.
- Weak-network recovery is automatic and aggregate. Heather does not diagnose individual networks or manage retries.
- No new mode, venue CRM, sponsor inventory, or league administration is included.

This spec supersedes only the earlier `host phone remains unchanged` non-goal in the Original Mode Refinements design. It does not weaken that design's laptop parity, trusted-question, TV readability, or network-safety requirements.

## Category Signature: Show Pulse

Show Pulse is a coordinated cross-surface state transition, not a success toast.

When Heather shows a question or answer:

1. The host control compresses and gives one restrained haptic response when supported.
2. The host phone enters `sending` while retaining the last confirmed room state.
3. The canonical server action advances the room once.
4. The venue TV and player phones apply the new run/revision/play state.
5. The host receives an audience-safe delivery receipt:
   - `TV live ✓`
   - `30 phones live ✓`
   - `1 recovering — answer protected`
6. The host surface settles on `Shown everywhere` when all reachable surfaces are current. A recovering device remains visible as an aggregate until it catches up.

Show Pulse does not promise impossible device certainty. `Live` means the surface has acknowledged or demonstrably fetched the current canonical revision. `Recovering` means TR1VIA has not yet observed that revision on that surface, not that the player lost an answer.

The product must never claim a disconnected or sleeping browser is current.

## Host Experience

### Persistent structure

Portrait phone navigation remains one tap deep:

- **Board** — familiar 3-column by 7-row board and private cell preview.
- **Room** — roster, connection health, late-player entry, player removal, and show lifecycle controls.
- **Scores** — standings, point adjustments, audit reason, and temporary undo where the action is genuinely reversible.
- **Monitor** — the exact venue-TV state plus the controls relevant to the current show moment.

There is no generic `More` drawer for live-critical controls.

The current live state automatically takes focus:

- between questions → Board;
- selected cell → Private preview;
- question active → Live question command;
- answer resolved → Answer result;
- game ended but next game not started → Intermission;
- both games complete → Finale.

Heather may navigate away, but she should rarely need to.

### Always-visible truth

Every live host surface includes a compact room-truth region showing the applicable subset of:

- active game and question state;
- player count;
- confirmed answer count;
- venue-TV current/recovering state;
- aggregate player-phone current/recovering state;
- last confirmed action;
- one contextual primary action.

The venue monitor is represented by a live thumbnail or clear current-state preview, not an abstract icon alone.

## Complete Show Lifecycle

### 1. Show Ready

Before Game 1, Heather sees one preflight screen with five independent checks:

- certified game content is ready;
- venue TV is connected and showing the waiting screen;
- joined players are current;
- room network test is healthy;
- host phone and laptop controls are available.

The screen includes a scaled venue-TV preview, room code, player count, `Run room sync test`, and `Start Game 1`.

The start button is enabled when the game, host ownership, and venue-TV state are valid. Player count alone does not block start. A recovering player produces a truthful warning, not an indefinite spinner.

### 2. Private Selection

The familiar board remains the default. Heather taps a cell, reviews the question, answer choices, correct answer, and host note privately, then selects `Reveal to room`.

While Heather previews:

- player phones show a calm `Next question coming` state;
- the venue TV may show category and value but no private content;
- the previous answer state is not reused as fallback.

### 3. Question Launch

Show Pulse advances host, TV, and player surfaces to the same immutable play and room revision.

- The TV prioritizes readable question text, four choices, timer, and aggregate locked count.
- Player phones replace prior-game or prior-question history immediately.
- The host sees timer, confirmed locks, waiting count, and aggregate delivery health.

### 4. Lock-In

Player submission follows the approved authoritative answer engine:

- tap → `Sending your answer…`;
- server confirmation → small haptic and `Saved to the room` / `Locked in ✓`;
- lost acknowledgement → automatic reconciliation;
- player reconnect → canonical current screen plus brief `Back in sync`;
- proven missed deadline → honest message and synchronization for the next question.

The venue TV gathers anonymous lock-in energy as the confirmed count rises. It does not show player names, choices, or suspicious-player indicators during the question.

### 5. Answer Result

After resolution, the host phone shows:

- correct answer;
- number and percentage correct;
- choice distribution;
- fastest five confirmed correct responses;
- a quiet evidence-only review entry when repeated fair-play patterns meet the approved threshold;
- one primary action: `Return to board`.

Player phones show the player's personal result and score movement. The venue TV shows a large correct answer, readable fact/tip, room outcome, and brief bounded celebration.

The played cell marks itself and the board returns automatically after the reveal moment or immediately when Heather presses `Return to board`.

### 6. Intermission

When Game 1 ends, all surfaces enter an explicit intermission state scoped to Game 2:

- Host: `Game 1 complete · Game 2 ready · Start when you're ready`.
- Player: current score/standing and `Game 2 starts when Heather is ready`.
- TV: current standings, break message, and Game 2 status.

The canonical state explicitly contains no active question. Refresh, focus recovery, and reconnect must rebuild this intermission rather than show Game 1's final reveal.

### 7. Finale

After the final game:

1. Heather reviews final adjustments and their audit history.
2. Heather selects `Present winners`.
3. The TV presents the winner and top standings with room-readable typography.
4. Each player phone shows a personal recap: score, placement, correct count, streak, and movement during the night.
5. TV and phone surfaces show the next scheduled venue night when one exists.

The room closes deliberately after the celebration. Presenting winners does not silently close the room.

## Weak-Network Experience

Network recovery must remain a non-blocking layer on the current host state.

Example host copy:

> **1 phone catching up**
>
> The locked answer is already saved.

The detail view separates:

- venue TV: current or recovering;
- aggregate player phones: current count;
- aggregate player phones: recovering count;
- automatic retry progress;
- authoritative answer protection.

Rules:

- Keep the last confirmed TV/player state visible; never blank the room.
- Do not replace the host command surface with a blocking spinner.
- Do not expose Wi-Fi/cellular details, device identifiers, or individual answer choices.
- Do not ask Heather to retry routine delivery.
- Preserve the host's contextual action when the canonical server can safely accept it.
- If the server cannot safely advance, disable that action with a specific reason and continue automatic recovery.
- A surface acknowledgement is informational; authoritative state and scoring remain in the server/database transaction.

## Fair-Play Review

Fair-play review appears only on the private host surface.

The default state is `No unusual patterns`.

A player becomes `Worth a look` only from repeated evidence across questions, such as:

- repeated off-screen events during live answer windows followed by unusually fast correct answers;
- consistently extreme response speed and accuracy relative to the room;
- repeated synchronized answer patterns that exceed the approved false-positive threshold.

One app switch, one fast answer, or one lucky streak never creates a flag.

The review presents the evidence timeline and room baseline. It never uses `cheater`, automatically changes a score, or publicly identifies the player. Heather may take no action or open the existing audited point-adjustment flow.

## Responsive and Accessibility Contract

### Host devices

- Portrait phone: 320–440 CSS pixels wide, including short 320×568 viewports and safe areas.
- Landscape phone: venue TV remains full-width with a separate command rail; controls never cover the TV preview.
- Tablet/iPad: familiar board and private/live control pane remain visible together.
- Laptop: every live action remains available and familiar.

### Venue TV

- Validate at 1280×720 and 1920×1080.
- Use the existing room-distance typography requirements from Original Mode Refinements.
- Never use a moving player-name ticker during a question.
- Never expose private host evidence, correct answers before reveal, or device/network details.

### Motion and haptics

- Show Pulse is one orchestrated transition, not scattered animation.
- Respect `prefers-reduced-motion` and platform haptic settings.
- Color never carries state alone; labels and icons remain present.
- Motion must not delay the canonical state or the host's next safe action.

## State and Delivery Model

The UI consumes the existing authoritative identifiers and revisions from the live answer engine:

- `runId`;
- `roomRevision`;
- `controlRevision`;
- `playId`;
- current game and play state;
- audience-safe aggregate counts.

Show Pulse adds delivery-observation state without granting authority:

- surface type: host, TV, or player;
- canonical run/revision/play last observed;
- acknowledgement/fetch timestamp;
- current/recovering classification;
- aggregate counts for host display.

Do not broadcast device identifiers or build a public per-device presence feed. Exact storage and retention require security review during implementation planning.

## Error Handling

| Situation | Required result |
| --- | --- |
| Host action still traveling | Keep last confirmed state and show `Sending…`; never advance optimistically |
| TV has not observed current revision | Show TV as recovering; retain last valid TV stage |
| One or more player phones lag | Show aggregate recovering count; answers already accepted remain protected |
| Player answer acknowledgement is lost | Reconcile to canonical saved answer |
| Game 2 has no active question | Show explicit Game 2 waiting/intermission, never Game 1 reveal history |
| Room-wide interruption | First recovered surface triggers idempotent canonical reconciliation; never auto-void |
| Fair-play evidence is incomplete | Show no flag |
| Next event is unknown | Omit the invitation rather than invent a date |
| Haptics or motion unavailable | Preserve the same labels, state transitions, and delivery receipt |

## Deliberate Exclusions

- New visual, I Spy, survey, or social game modes.
- Venue CRM, sponsor inventory, ad network, or league administration.
- Open chat, free text, or host moderation workload.
- Voice commands during live play.
- AI changing live questions, scores, or host actions.
- Automatic cheating accusations or penalties.
- Forced player accounts, downloads, or payments.
- Forced host-phone use.
- Reaction-based scoring.

## Market-Proof Pilot

Run the finished experience for four recurring weeks with Heather and at least two additional hosts.

The live-room show console thesis earns continuation when:

- hosts perform most live actions from the phone by choice while the laptop remains available;
- no player reports a stale screen, missing save, or uncertainty about the current game;
- hosts require no more than one manual recovery intervention per night;
- at least 70% of joined players remain through the finale;
- at least one bounded shared room reaction occurs without host explanation;
- returning anonymous devices increase over consecutive weeks;
- at least two venues voluntarily schedule another night.

The thesis is not yet proven if hosts retreat to the laptop, players ignore the shared beat, or venues praise the polish without scheduling another night.

## Verification Contract

- Component tests cover every host state and contextual primary action.
- Integration tests prove delivery receipts cannot advance or score the game.
- Security tests prove audience-shaped delivery data does not expose device IDs, player answers, or private host fields.
- End-to-end tests exercise Show Ready → question → lock-in → answer result → board → intermission → Game 2 → finale across host, TV, and multiple player contexts.
- Recovery tests delay broadcasts, lose acknowledgements, refresh players, reconnect TV, and deliver stale revisions out of order.
- Screenshot tests cover host phone at 320×568 and 430×932, phone landscape, iPad landscape, and TV at 720p/1080p.
- Reduced-motion and no-haptics paths preserve all information.
- A production rehearsal uses an authorized test host and synthetic night, then removes its test data.

## Implementation Order

1. Lock the show-state contract and audience-safe delivery-observation model.
2. Build Show Ready and the always-visible room-truth region.
3. Build Show Pulse receipts on top of canonical revisions without changing scoring authority.
4. Complete answer-result and automatic board-return choreography.
5. Complete explicit intermission and finale states across all surfaces.
6. Add aggregate weak-network recovery presentation.
7. Add fair-play review only after false-positive and privacy review.
8. Run the four-week market-proof pilot before venue-business expansion.

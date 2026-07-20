# Account-First Host Control and Clear Device Roles

**Status:** Conversational design approved by Brandon on 2026-07-20; written specification awaiting review.

**Mode:** Heather's Classic / Original trivia mode. This is a host-entry, device-role, and display-scaling refinement. It does not introduce a new game mode.

## Outcome

A host can open TR1VIA on any signed-in phone, immediately recognize tonight's active game, and select **Control live game**. No QR, pairing code, or separate remote setup is required.

Each device has one obvious job:

- **Host phone:** private game command center.
- **Host laptop connected to the TV:** venue presentation plus complete backup controls.
- **Venue TV:** audience-safe game display.
- **Player phones:** join and answer.

The product answers who should use each action before asking the host to act.

## Approved Product Decisions

1. Host account authentication and owned-game authorization replace host-phone QR pairing.
2. **Control live game** is the phone's primary live-game action.
3. Control is shared between authenticated host devices. It is not an exclusive lease and does not disable the laptop.
4. **Show game on this laptop/TV** is the laptop presentation action.
5. **Players — scan to join this game** is the only prominent QR handoff.
6. The host phone's **TV** destination is a preview, not a link that turns the phone into the venue display.
7. Every venue preview and venue display uses one fixed logical 16:9 canvas that scales proportionally without reflowing or cropping its contents.

## Language Contract

Use these exact customer-facing labels:

- **Control live game**
- **Show game on this laptop/TV**
- **Players — scan to join this game**
- **What players see** for the private host preview heading
- **TV preview** for the phone navigation destination

Do not use:

- `Take control` or `Gain control`, because neither device loses access;
- `Phone remote`, because the phone is a complete host surface rather than an accessory;
- `Room` as a customer-facing substitute for game, players, or TV;
- unlabeled `TV view`, `Open venue screen`, or `Scan this` actions;
- any host QR in the ordinary flow.

## Host Account Entry

### Returning signed-in host

1. The host opens `tr1via.com/host` on a phone.
2. The dashboard identifies the owned active game.
3. The active-game card presents **Control live game** as the dominant action.
4. The action opens the adaptive live host surface for that game.
5. A phone receives the private command center; a laptop receives the full presentation console.

The host never needs to know or choose between internal `/host/live` and `/host/phone` routes.

### Signed-out host

1. The host opens `tr1via.com/host` or an owned-game deep link.
2. TR1VIA requests ordinary host sign-in.
3. The intended game destination is retained through authentication.
4. Successful sign-in returns directly to **Control live game** for that owned game.

The phone session should remain signed in under the existing session policy. Passkeys, a native app, and an install prompt are outside this refinement.

### No active game

The dashboard does not manufacture a control destination:

- incomplete game → **Continue setup**;
- ready but unopened game → **Open game controls**;
- completed game → **View results** or **Plan the next game**;
- multiple active owned games → show the owned games explicitly and require one selection.

The dashboard must not silently choose between multiple active games.

## Canonical Routes and Compatibility

- `/host/live/[nightId]` is the canonical authenticated live-game entry.
- Its existing adaptive boundary selects the phone command center on compact devices and the laptop presentation console on wider devices.
- `/host/phone/[nightId]` remains temporarily as a compatibility entry for old saved links, but it is no longer advertised or encoded in a QR. After authorization, it redirects to `/host/live/[nightId]` so both entries use the same adaptive experience.
- `/tv/[code]` remains the anonymous, audience-safe display route for a clean companion display. It is not linked as a phone preview.
- `/join?code=[code]` remains the anonymous player destination encoded by the player QR.

No database migration or new device-pairing state is required.

## Multi-Device Control

The same authorized host account may use the phone and laptop simultaneously.

- Both devices subscribe to the same canonical game state.
- An action accepted from either device updates both devices, the venue TV, and player phones.
- Existing authoritative command receipts, game revisions, and idempotency protections remain responsible for duplicate or racing actions.
- The interface never claims one device has exclusive ownership.
- A temporarily disconnected device recovers to the canonical state before presenting a new successful action.
- A host signed into a different account cannot control a game they do not own.

No new device-locking, controller-election, or takeover protocol is introduced.

## Phone Command Center

The phone remains the complete private host surface defined by the Live Game Console design:

- familiar question board and private question preview;
- question launch, timer, answer result, intermission, and finale controls;
- players, scores, point adjustments, undo, and lifecycle actions;
- truthful connection and delivery status;
- correct answers and host-only evidence that never appear on the venue display.

The host dashboard and all live-game redirects must lead to this surface automatically on phone-sized devices.

### TV preview on the phone

The phone's **TV preview** destination shows **What players see** inside the host command center.

- Render the exact audience-safe state using a fixed 1600×900 logical canvas.
- Scale the complete canvas to the available preview frame.
- Preserve the full composition in portrait and landscape; letterboxing is acceptable, cropping is not.
- Keep the preview non-interactive so a host cannot accidentally reveal a question by touching the miniature board.
- Do not show a second `TV view` or `Open full venue display` link on compact screens.
- Keep private answers, fair-play evidence, device identifiers, and host commands outside the preview.

## Laptop and Venue Display

The laptop action **Show game on this laptop/TV** opens the existing adaptive laptop presentation console. This is the expected path when the laptop is connected to the venue TV.

The laptop remains a complete backup control surface. The phone becoming active does not blank, lock, or downgrade it.

The clean anonymous `/tv/[code]` route remains available for a genuinely separate display, but it must use the same fixed logical canvas as the phone preview:

- logical size: 1600×900;
- scale to the largest contained 16:9 area;
- center within the available viewport;
- never recalculate desktop typography and columns against a narrow phone-sized canvas;
- never crop question, answer, fact, standings, footer, or player-name content.

Validated venue sizes remain 1280×720 and 1920×1080. Regression sizes also include 390×844 portrait and 844×390 landscape so an accidental phone opening remains legible and complete.

## Player QR

The player QR is the only QR promoted during a game.

Required presentation:

> **Players — scan to join this game**
>
> `tr1via.com/join` · code `ABC123`

Rules:

- The QR always resolves to the anonymous player join flow for the current game code.
- It may appear on the venue lobby, intermission, and the host's Players panel for late arrivals.
- It never opens host controls or a venue display.
- It never requires a player account.
- The surrounding label remains visible so a screenshot of the QR retains its meaning.

## Host Change Notice

The existing host-only What's New surface may show one concise entry after release:

> **Your phone is now a full game controller**
>
> Sign in on your phone and tap **Control live game**. No host QR or pairing step is needed. Your laptop controls still work.

The notice appears only to hosts, is dismissible, and does not interrupt a live game.

## Failure and Recovery Behavior

### Authentication expires

- Preserve the intended game destination.
- Sign the host in again.
- Return directly to the owned live game.
- Never fall through to the player join flow.

### Phone loses connectivity

- Keep the last confirmed private game state visible.
- Show the existing recovery status without a blocking full-screen spinner.
- Do not claim an action succeeded until its authoritative receipt arrives.
- Recover automatically when connectivity returns.

### Laptop or TV loses connectivity

- Keep the last confirmed audience-safe state visible.
- Let the phone continue controlling the canonical game when the server is reachable.
- Surface truthful TV recovery status privately to the host.

### Game ends or ownership changes

- Remove **Control live game** when the game is no longer active.
- Return the host to the appropriate results or dashboard state.
- Fail closed when the signed-in account no longer owns the game.

## Security and Privacy

- Existing host authentication and owned-game authorization remain the security boundary.
- A host URL alone grants no control without authentication and ownership.
- The anonymous venue route remains read-only and audience-safe.
- The player join route remains anonymous but device-scoped under the existing player identity model.
- Correct answers before reveal, host-only evidence, and private device information never enter TV or player payloads.
- Removing the host QR does not weaken authorization because the QR was only a navigation shortcut, not the trust boundary.

## Accessibility and Responsive Contract

- Phone command center: 320–440 CSS pixels wide, including safe areas and 320×568 short screens.
- Landscape phone: 844×390 minimum regression target; controls remain reachable while the complete TV preview stays visible.
- Tablet: board, private controls, and proportional TV preview use available space without hidden actions.
- Laptop: 1280×720 minimum; venue presentation and backup controls remain complete.
- Touch targets: at least 48 CSS pixels for live host actions.
- Color never carries device role, connection state, or action meaning alone.
- Labels identify the destination and intended user before navigation.

## Test and Proof Contract

### Unit and component tests

- The phone dashboard renders **Control live game** for an owned active game.
- Signed-out deep links preserve and restore the intended game destination.
- Compact live entry renders the private command center; wide live entry renders the laptop presentation console.
- No rendered host surface contains a host QR or promoted `/host/phone` handoff.
- Player QR copy and destination are exact.
- The phone TV preview renders a 1600×900 non-interactive logical canvas.
- Compact surfaces do not render direct `/tv/[code]` links.

### Browser tests

- Signed-in iPhone: dashboard → **Control live game** → familiar board without QR or route choice.
- Signed-out iPhone: sign in → automatic return to the same live game.
- Laptop: dashboard → **Show game on this laptop/TV** → complete presentation console.
- Phone and laptop issue sequential actions and reconcile to the same canonical state.
- Duplicate/racing actions remain idempotent under the existing authoritative engine.
- Player QR opens only the anonymous join flow.

### Visual tests

Capture the TV question, standard reveal, stumper reveal, intermission, and finale at:

- 390×844 portrait phone preview;
- 844×390 landscape phone preview;
- 768×1024 tablet preview;
- 1280×720 venue display;
- 1920×1080 venue display.

Every capture must show the complete 16:9 composition. A test fails for horizontal overflow, vertical clipping, missing answer/fact/footer content, or private host information.

## Acceptance Criteria

This refinement is complete only when:

1. A returning host can reach an active game from a phone with one tap after opening the host dashboard.
2. A signed-out host returns directly to the intended game after authentication.
3. No ordinary host workflow requires or promotes a host QR.
4. Phone and laptop controls remain simultaneously available and synchronized.
5. The player QR is the only prominent QR and is unmistakably labeled for players.
6. The phone TV preview shows the complete audience composition in portrait and landscape.
7. The venue route also scales the fixed composition without reflow or clipping.
8. Customer-facing controls use `game`, `players`, `phone`, `laptop`, or `TV` precisely and do not use generic `Room` language.
9. Existing Original-mode rules, scoring, question order, monthly themes, and player accountlessness remain unchanged.
10. Targeted unit, component, browser, visual, type, build, and production smoke checks pass before release.

## Rollback and Stop Conditions

- Preserve `/host/phone/[nightId]` as a compatibility entry during rollout so old links do not strand a host.
- The account-first dashboard labels and compact-link removal are independently reversible.
- The fixed-canvas display change must not ship if it introduces clipping at 1280×720 or 1920×1080.
- Stop and re-plan if the implementation requires exclusive device control, a new database pairing model, weakened ownership checks, or a new player account requirement.

## Non-Goals

- Native iOS or Android application;
- passkeys or biometric-login redesign;
- smart-TV casting or remote TV pairing;
- exclusive controller ownership;
- venue CRM, scheduling, billing, or account-role redesign;
- a new trivia game mode;
- changes to Original-mode rules, scoring, or generated content.

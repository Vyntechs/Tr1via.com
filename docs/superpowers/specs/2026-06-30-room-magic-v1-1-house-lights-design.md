# Room Magic v1.1 House Lights Design

**Status:** proposed packet and design spec
**Date:** 2026-06-30
**Packet:** Room Magic v1.1: House Lights

## 1. Intent

Room Magic v1.1 makes the room feel alive during the waiting moment after players answer, without adding a new game mechanic.

The product promise is:

> When a player locks in, every surface quietly shows that their action joined the room.

This is not chat, not sound, not a feed, and not a second scoring system. It is a visual presence layer around Heather's Classic.

## 2. Recommendation

Build **House Lights**: a silent, screen-edge live presence layer powered by existing lock-in state.

The first slice is **Lock-In Energy**:

- player phones confirm the answer was sent to the room
- the TV shows restrained aggregate room energy while players lock in
- the host embedded TV mirrors the same room energy
- all behavior is gated by the existing Room Magic setting
- Heather's Classic remains unchanged when Room Magic is off

Do not create a new presence table, realtime transport, player feed, profile system, or moderation surface.

## 3. Capability Packet

**Name:** Room Magic v1.1: House Lights

**User/business outcome:** Players feel connected to the room before reveal, and hosts see a livelier TV without learning a new workflow.

**Included behavior:**

- lock-in energy during active questions
- visual confirmation on player phones after answer submission
- TV perimeter or edge-based presence glow derived from aggregate lock count
- host embedded-TV mirror of the same visual treatment
- reduced-motion equivalent that preserves meaning without animation
- default-off Classic safety through the existing Room Magic toggle

**Excluded behavior:**

- open chat
- free text
- new reactions before reveal
- player profiles or avatars
- public player history
- player-to-player interaction
- reaction scoring
- host moderation tools
- new database tables
- new production database change files
- any change to answer, reveal, resolve, score, timer, or leaderboard rules

**Source truth:**

- `docs/product/tr1via-product-vision-and-scope.md`
- `docs/superpowers/specs/2026-06-29-room-magic-v1-design.md`
- existing Room Magic v1 implementation: default-off setting, post-reveal reactions, TV/host overlay, and E2E coverage

**Dependencies:**

- existing `nights.room_magic_enabled`
- existing answer rows and lock-in counts
- existing TV snapshot/live answer shape
- existing player locked screen
- existing TV state machine and host embedded TV

**Risk gates:**

- no Room Magic UI when disabled
- no new player action during answering
- no answer data leakage
- no scoring changes
- no host moderation burden
- no production DB work

**Suggested agents for implementation planning:**

- builder-tech-lead for file ownership and branch strategy
- frontend-design/worldclass-visual-magic for the House Lights visual law
- qa-test-engineer for cross-surface verification
- critic/validator before PR

**Done-when:** On a Room Magic-enabled night, lock-ins visibly nudge player, TV, and host-mirror surfaces through aggregate presence only. With Room Magic off, Classic looks and behaves unchanged.

**Validation target:** A project-owned automated rehearsal must prove the feature across host, TV, and multiple player phones. Brandon should not be the validation system.

## 4. Product Doctrine

House Lights is TR1VIA's first ownable live-room presence system.

The metaphor is theatrical: the TV is the stage, phones are controllers, and valid player actions briefly light the edges of the house. The product action stays central. The magic lives around the content, never on top of it.

Core rules:

- Magic is visual-only.
- Magic is aggregate, not personal.
- Magic is edge-bound, not content-covering.
- Magic is quiet enough for a host to ignore.
- Magic is clear enough for a player to feel.
- Magic never changes Heather's game contract.

Internal language:

- Use **House Lights** for the v1.1 visual system.
- Use **Presence Glow** for the animated visual unit.
- Use **Sent to the room** for player confirmation.
- Avoid language that implies audio, physical venue control, chat, or generic decoration.

## 5. UX Requirements

### 5.1 Player Phone

After a player answers, the locked screen should feel connected instead of frozen.

Requirements:

- Keep the current chosen-answer state.
- Keep the current timer and lock-in progress behavior.
- Show a short confirmation using the phrase "Sent to the room."
- If House Lights visual treatment appears on phone, keep it subtle and edge-bound.
- Do not add any new control before reveal.
- Do not show other players' answer choices.
- Do not require accounts, avatars, or names beyond the existing game identity.
- Reduced-motion users get a calm visible state change instead of a pulse animation.

Success:

- A player understands their answer reached the room.
- The wait for the rest of the room feels alive.
- Nothing distracts from the answer already chosen.

### 5.2 Venue TV

The TV should turn aggregate lock-ins into shared atmosphere.

Requirements:

- Use existing live lock-in counts or `liveAnswers` data only.
- Render House Lights at the screen edge or in the existing lock-in area.
- Avoid covering prompt, options, answer, fastest list, scores, or host-readable content.
- Use aggregate progress, not individual notifications.
- Do not display answer correctness or chosen options during a live question.
- Do not use confetti, particle spam, sticker-like popups, sound language, or generic sparkle.
- Reduced-motion users should see static progress, glow strength, count, or fill state.

Success:

- The room can tell more people are locking in.
- The TV feels responsive before reveal.
- The screen still reads as trivia first.

### 5.3 Host Surface

The host should get confidence, not work.

Requirements:

- The host embedded TV mirrors the TV House Lights treatment.
- No live moderation panel.
- No reaction queue.
- No new host decision while the timer is running.
- Existing setup toggle remains the control surface for enabling Room Magic.

Success:

- The host sees that the room is moving.
- The host does not have to manage the room's energy.

## 6. Data and Transport

House Lights should avoid database changes.

Use:

- existing `nights.room_magic_enabled`
- existing players and answer records
- existing lock-in counts and TV snapshot data
- existing host live answer subscription or derived counts

Do not add:

- a `presence` table
- a new player event table
- a new broadcast required for answer submission
- durable storage for House Lights events

Transport rule:

House Lights must be derived from existing game state. If a cosmetic signal is ever added later, it must be best-effort and must not sit in the critical path for answer submission, reveal, resolve, or scoring.

Security rule:

Live answer data must stay masked. House Lights may show how many players have locked in; it must not expose what they picked or whether they are correct before reveal.

## 7. Failure Handling

House Lights must fail like a senior live-product system: boring, contained, observable, and easy to roll back.

The default failure posture is **remove the enhancement, preserve the game**.

Failure behavior:

- If Room Magic setting is false, missing, or unreadable, House Lights is off.
- If live lock-in count is unavailable, invalid, stale, or inconsistent, the UI falls back to the current Classic display.
- If a player count is zero, negative, greater than the room size, or otherwise impossible, House Lights hides instead of guessing.
- If answer rows include duplicates, stale rows, missing player IDs, or rows for a different question, House Lights ignores those rows for visual presence.
- If a browser refresh misses transient live state, the next durable snapshot may restore aggregate presence, but no stale glow should be reconstructed after the question ends.
- If standalone TV and host embedded TV disagree temporarily, neither surface blocks gameplay; validation should catch drift before release.
- If an animation fails or reduced motion is enabled, static progress remains understandable.
- If the visual layer throws, the feature boundary must collapse to the Classic lock-in UI rather than blanking the TV or phone.
- If network conditions degrade, existing connection recovery behavior owns the message; House Lights should not add alarming user-facing errors.
- No House Lights failure blocks answering, timer, reveal, resolve, leaderboard, or host controls.

Input hardening requirements:

- Clamp progress to `0..100`.
- Derive aggregate presence from the active question only.
- Never read or render `chosen_index`, answer text, correctness, scramble, device IDs, cookies, or private host data.
- Render nothing for malformed props instead of throwing.
- Cap any visual layer count or intensity so a large room cannot flood the screen.
- Keep all House Lights state cosmetic and replaceable.

Observability requirements:

- Components need stable `data-testid` hooks for disabled, enabled, reduced-motion, and fallback states.
- Automated validation must fail on unexpected browser console errors during the rehearsal.
- Failed validation must save enough evidence to debug without asking Brandon to reproduce it manually: screenshots, trace/video where available, final score snapshot, room code/night ID for non-production local runs, and a short machine-readable result summary.

Rollback:

- Immediate behavior rollback: turn Room Magic off for the night.
- Code rollback: revert the v1.1 app PR.
- No database rollback should be needed because v1.1 does not add schema.

## 8. Hands-Off Validation Harness

House Lights should ship with reusable validation, not one-off human review.

The implementation plan should add or extend a project-owned local rehearsal command for Room Magic. The preferred shape is a Playwright-based harness because the product is defined by multiple real browser surfaces:

- one host laptop context
- one venue TV context
- at least three player phone contexts
- one disabled Classic run
- one Room Magic-enabled run
- one reduced-motion run or reduced-motion assertion path
- one refresh/rejoin recovery check if it can be done without bloating the slice

The harness should:

- seed a test night through existing test-only routes
- open the host live console, standalone TV, and phones
- start a game, reveal one question, submit answers from all phones, and observe lock-in state before resolve
- assert no House Lights affordance appears when Room Magic is off
- assert House Lights appears on player, TV, and host embedded TV when Room Magic is on
- assert scores and reveal results match the disabled Classic baseline
- capture screenshots for the important surfaces
- fail if browser console errors appear
- clean up test data

Preferred project command, to be finalized in the implementation plan:

```bash
npm run validate:room-magic
```

The command should use very little or no AI. AI agents may read the artifacts during development, but the pass/fail gate must be deterministic and repeatable.

Suggested artifact location:

```text
test-results/room-magic-house-lights/
```

Each run should produce a small result summary that answers:

- Did Classic disabled remain visually unchanged?
- Did Room Magic enabled show House Lights on all required surfaces?
- Did reduced motion preserve meaning?
- Did scores match between disabled and enabled runs?
- Were there console errors?
- Which screenshots/traces prove it?

This harness becomes reusable for future Room Magic packets.

## 9. Verification

Implementation must prove:

- Classic disabled shows no House Lights UI.
- Room Magic enabled shows lock-in presence on player, TV, and host embedded TV.
- Scores match the same flow with Room Magic off.
- No answer, reveal, resolve, timer, or leaderboard behavior changes.
- Live answer masking remains intact.
- Reduced-motion mode preserves meaning without animation dependence.
- Reconnect or refresh does not create duplicate presence or stale room energy.

Suggested automated checks:

- component tests for TV House Lights rendering and disabled behavior
- component tests for player locked confirmation and reduced-motion behavior
- unit tests for any derived progress/threshold helper
- E2E update to `tests/e2e/room-magic.spec.ts`
- regression coverage alongside reveal sync if the TV/host live path is touched
- deterministic Room Magic validation command that runs the multi-surface rehearsal and saves artifacts

Suggested visual evidence:

- player phone locked state, Room Magic off
- player phone locked state, Room Magic on
- TV active question with Room Magic off
- TV active question with House Lights on
- host embedded TV with House Lights on
- reduced-motion version

Merge blockers:

- House Lights visible when Room Magic is off
- any score difference between Classic and Room Magic runs
- any live answer choice or correctness leakage
- any new host moderation/control burden
- any production database change introduced by this packet
- any UI covering the question, answers, reveal, scores, or host controls
- automated rehearsal missing, flaky, or unable to produce evidence
- unexpected browser console errors during the rehearsal
- no rollback path beyond "ask Brandon to inspect it"

## 10. Branch, Review, and Release Strategy

The branching strategy should reduce Brandon's manual burden while keeping production boringly safe.

`main` remains production-safe. Feature work does not land on `main` because it looks good to an agent; it lands only after deterministic validation and agent review.

Implementation should branch from latest `main`, not from the old production-smoke fix branch.

Recommended branch:

`staging/room-magic-v1-1-house-lights`

Recommended flow:

- Create task branches from `main` or from the staging branch, depending on implementation size.
- Use small PRs into `staging/room-magic-v1-1-house-lights` when multiple agents own disjoint files.
- Keep one owner per write surface: player phone, TV/host visual layer, validation harness, review/cleanup.
- Require each task PR to include its own tests or artifact update.
- Run reviewer agents against the actual diff, not worker summaries.
- Merge staging to `main` only after the full Room Magic validation command, relevant unit/component tests, E2E, and review are green.
- Do not ask Brandon to manually validate normal UI correctness. Brandon's gate is approval to merge/deploy, not being the test runner.

Release stance:

- no production database touch
- no deploy without Brandon approval
- ship behind the existing Room Magic toggle
- existing nights and hosts remain Classic unless Room Magic is explicitly enabled
- safe to merge only after automated cross-surface verification produces artifacts
- production users should experience the same working Classic flow first, then optional additions as they are enabled

If implementation remains visual-only and no schema/API contract changes are needed, this can likely PR directly to `main` after review. If the work expands into transport, API changes, or shared live-state contracts, move it to a staging branch and re-plan.

Production safety gates:

- Local deterministic validation green.
- Existing Room Magic E2E green.
- Reveal sync or full-game regression green when touched paths affect live state.
- No new production DB change file.
- No change to default-off behavior.
- No unexpected console errors in the rehearsal.
- Post-merge production smoke stays green.

Human gates:

- Brandon approves merge to `main`.
- Brandon approves deploy if deploy is not automatic through the normal merge path.
- Brandon approves any production DB work, pricing, auth, payment, live customer data, or public-facing claim.

Agent-owned gates:

- agents produce implementation plan
- agents execute tasks
- agents review changed paths
- agents run validation
- agents summarize evidence and screenshots
- agents investigate red checks instead of dismissing them

## 11. Agent Development Plan

Use agents, but keep one writer per artifact.

Planning agents:

- Product/customer: confirm the slice increases interaction without social-feed risk.
- Visual magic/design: refine House Lights and Presence Glow with restraint.
- Tech lead: confirm no DB changes and identify safe file boundaries.
- QA: define cross-surface proof before implementation.

Implementation agents can run in parallel only with disjoint write sets. A likely split:

- TV/host visual layer owner
- player locked-state owner
- tests/verification owner
- reviewer/validator owner

The implementation plan must assign exact file ownership before any code changes.

## 12. Self-Review

- Placeholder scan: no TBD or TODO markers remain.
- Internal consistency: House Lights is default-off, cosmetic, aggregate, visual-only, failure-contained, and Classic-safe throughout.
- Scope check: v1.1 is one bounded slice focused on lock-in presence, not a social system.
- Ambiguity check: DB stance, non-goals, failure behavior, automated validation, branch/review gates, and rollback path are explicit.

# Original Mode Refinements Design

**Status:** Approved by Brandon on 2026-07-18.

## Outcome

Heather can prepare and host the existing Original game from her laptop without a weekly founder audit, unexplained generation waits, stale Game 1 screens, or venue text that older players cannot read. Player phones remain frictionless across supported screen sizes. No new game mode is introduced.

## Protected Behavior

- Original mode remains Heather's intelligent default.
- Heather's laptop remains the complete control surface for setup and live play.
- The host phone remains optional and unchanged.
- Players do not create accounts or install an app.
- A question image is decorative in Original mode; the question must remain answerable without it.
- Production merge, migration application, and deployment remain founder gates.

## Host-only What's New

After release, authenticated hosts see a one-time dashboard card titled **“Your games now protect themselves.”** It explains three benefits in plain language: questions are checked before they become usable, generation continues safely with visible progress, and player/TV screens recover more clearly. It is never rendered on player, TV, marketing, login, or join surfaces.

The card is dismissible and can be reopened from a quiet **What's new** dashboard control. Dismissal is versioned in the host browser so future releases can present a new notice without repeating this one.

The honest support instruction is:

> TR1VIA still uses AI, and no fact-check is perfect. If a question or screen still looks wrong after Retry, stop before opening the game and contact Brandon.

## Trusted Question Gate

A generated candidate is usable only when two independent verifier passes agree that:

- the marked answer is the one defensible correct option;
- the wording is not ambiguous;
- the fact/tip is accurate and supports the answer;
- the question is answerable without an image;
- deterministic risk checks do not identify time-sensitive, subjective, ranking, geography, or multiple-answer wording that lacks adequate context.

Failed candidates are automatically replaced. Missing verdicts fail closed. Heather sees only certified candidates; the quality report remains available as supporting evidence, not a correction notice.

## Durable Generation Experience

AI generation continues after navigation because work runs server-side. A persisted generation job records the category, phase, target, certified count, image count, heartbeat, attempt count, and last recoverable error. The existing twenty-choice workflow remains intact: Heather receives up to twenty certified choices and selects seven.

The loading surface uses only real phases and counts:

- Queued
- Writing — `N of 20 choices written`
- Checking — `N of 20 choices certified`
- Repairing — `N choices still needed`
- Adding optional images — `N of 20 complete`
- Ready — `20 certified choices ready`

Verified choices are inserted after each successful collection round while the category remains in `generating`. A retry counts existing certified choices, preserves them, and generates only the shortfall. Photo failure never invalidates a question. A stale heartbeat becomes **Needs attention**, with Retry and Enter manually actions.

## Player Phones

Every player state must remain usable at 280, 320, 360, 390, 430, and 480 CSS-pixel widths; short portrait viewports; safe-area insets; and landscape. Dense states scroll vertically rather than clipping. Live question screens retain their fit-to-viewport behavior.

The verified state matrix includes join, lobby, question, submitting, locked, correct reveal, wrong reveal, standings, Game 2 invitation, opted-in Game 2 waiting, finale, reconnecting, and unreachable.

An opted-in player between games sees **“Round 2 is starting”** and **“Waiting for Heather to choose the first question.”** Refresh and reconnect rebuild from server state and never restore Game 1's final reveal.

## Venue TV

The question surface prioritizes the question, four answer choices, timer, and one stationary `N of M locked` indicator. The moving player-name marquee is removed from question screens. Player names and scores appear only on dedicated reveal/standings surfaces.

Readability targets at 16:9 720p and 1080p:

- question: 48–72px depending on length;
- answer choices: 28–34px;
- correct answer: 64–80px minimum effective size;
- fact/tip: 30–34px;
- fastest-player names: 28–32px.

Reveal screens use a dark, high-contrast reading surface with a restrained correct-color accent instead of a full neon wash. Motion is brief and respects reduced-motion preferences.

## Error and Recovery States

- Generation API/network failure: preserve certified choices, record **Needs attention**, offer Retry for only the shortfall.
- Verification disagreement: discard the candidate and generate a replacement.
- Fact/tip disagreement: discard the candidate and generate a replacement.
- Visual-dependent Original question: discard the candidate and generate a replacement.
- Image lookup failure: keep the certified text question without an image.
- Player reconnect: restore the current server-authoritative state.
- Host connection failure: retain the existing backup/unreachable messaging and avoid destructive actions.

## Non-goals

- Visual, I Spy, or other new game modes.
- Host-phone redesign or required host-phone use.
- Player accounts or app installation.
- Marketing-site announcements.
- Automatic production deployment or migration execution.

## Success Proof

- Unit and component tests prove the new certification conditions, host-only notice, dismissal, phone overflow behavior, and TV hierarchy.
- Schema integration tests prove generation-job ownership and access controls.
- End-to-end tests prove Game 1 → intermission → Game 2, refresh/reconnect before Game 2's first question, and live recovery.
- Automated screenshots cover every player state at the supported device matrix and TV at 1280×720 and 1920×1080.
- After founder merge, a production dry run uses the authorized test-host account and stops before any real venue night is altered.

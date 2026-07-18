### closure-narrowing-in-effects
Trigger: Nested async closure captured narrowed nullable id in host live effect.
Rule: Rebind narrowed values to non-null locals before nested closures use them.
Reason: TypeScript does not preserve outer narrowing across nested function boundaries.

### atomic-guarded-resolve
Trigger: App read all-locked eligibility, then called resolve_question separately.
Rule: Put check-and-resolve guards in one DB function with eligibility locks.
Reason: Participants or removals can change between app reads and later RPCs.

### pr-approval-before-panel
Trigger: PR was framed as keepable before performance and architecture lenses were convened.
Rule: For live-game reliability PRs, pressure-test cost, product, and abuse risk before merge guidance.
Reason: Cosmetic fixes can still add persistent load or public surface area.

### reaction-art-direction-approval
Trigger: Room Magic reaction effect looked technically visible but founder rejected the visual direction.
Rule: Treat visual rejection as stop-and-revert before iterating.
Reason: Layering more polish on a rejected direction wastes validation time.

### weekly-prod-readiness-is-not-launch-readiness
Trigger: Brandon asks whether tr1via is ready for host at the next scheduled game.
Rule: Treat it as a weekly live system; answer prep, risk, alert, and rollback state.
Reason: The product is already used in production, not waiting for first launch.

### prod-smoke-budget-matches-host-flow
Trigger: Prod smoke times out while live generation keeps heartbeating in the host flow.
Rule: Match smoke timeouts to the live UX budget before calling it an outage.
Reason: Alerts should catch broken production, not expected long generation.

### generation-poll-must-finish-and-outlive-worker
Trigger: Host sees generation failed while production logs show a completed background job.
Rule: Polling must emit completed on review/ready, and silent timeout must exceed server maxDuration.
Reason: Missed Realtime plus 45s timeout false-failed a healthy 69s job; retry duplicated 20 questions.

### room-magic-copy-no-role-labels
Trigger: Room Magic marketing visual uses unexplained role labels like TV, Marn, or Host.
Rule: Use explicit room-effect copy and player reactions instead of internal stage labels.
Reason: Hosts judge the feature by screenshot clarity before reading docs.

### marketing-screenshots-cold-visitor-check
Trigger: Brandon cannot verify a supplied marketing screenshot without being an avid TR1VIA user.
Rule: Judge screenshots by whether a cold visitor understands product, roles, action, and value in five seconds.
Reason: Rendered and polished is not enough; homepage proof must explain itself.

### heather-classic-market-expansion
Trigger: Brandon wants market capture without making Heather relearn the product.
Rule: Treat Heather's Classic as the protected proof core; build commercial layers and new modes around it.
Reason: Heather's comfort is the reliability benchmark while TR1VIA scales beyond one host.

### product-intent-requires-product-surface
Trigger: Brandon approves doctrine but asks whether agents will actually work in the product.
Rule: For market-capture intent, ship a bounded product-surface improvement unless Brandon asks for docs only.
Reason: Durable doctrine is useful only when it drives visible product progress.

### force-stage-project-lessons
Trigger: Git refuses to stage tracked project lessons because the repo ignores the tasks directory.
Rule: Use git add -f tasks/lessons.md when committing project lesson updates.
Reason: Lesson capture must not be skipped because local ignore rules block normal staging.

### fast-pr-needs-product-audit
Trigger: Brandon challenges a fast PR merge as unbelievable.
Rule: Audit patch scope, live rendering, tests, and unresolved product gaps before defending the PR.
Reason: Green checks prove mechanics, not that the product concern was actually solved.

### live-night-check-means-content-audit
Trigger: Brandon asks to "see" a built host night before a real show.
Rule: Audit question content/readiness, not just row counts. Check correctness, ambiguity, reveal blurbs, category fit, unfinished picks.
Reason: I reported Heather's night readiness counts when Brandon wanted question quality and correctness reviewed.

### trace-product-flow-before-planning
Trigger: Planning host/player/TV experience or support flow from conversation context.
Rule: Trace actual routes, screens, and state transitions before proposing flow changes. Do not infer public/private surfaces from mental model.
Reason: I assumed a separate TV/laptop flow; Brandon corrected that the real mirrored flow differs.

### pregame-qa-must-be-pre-display
Trigger: Brandon rejects after-the-fact correction notices for host-generated game content.
Rule: Certify questions, answers, facts, and images before showing them as ready; never rely on post-build correction notices.
Reason: Hosts plan from displayed content; later corrections break trust and may never be seen.

### host-waits-need-background-progress
Trigger: Heather waits on generation or verification during venue preparation.
Rule: Keep work running in background; make waits beautiful and calm with real phases, counts, elapsed or estimated time, and safe navigation.
Reason: Unbounded loading erodes trust and wastes host preparation time even when the worker is healthy.

### venue-tv-is-signage-not-desktop
Trigger: Mirrored host laptop is unreadable on the venue TV, especially answer options and moving player names.
Rule: Design live TV typography for older viewers at room distance; minimize density and continuous motion, then verify on a real venue-sized display.
Reason: Desktop-sized text can fit technically yet fail the actual audience.

### heather-laptop-is-primary-live-control
Trigger: Designing venue mode for Heather's mirrored laptop and optional host phone.
Rule: Keep every live control operable from the laptop; treat the phone as optional until clear pairing and onboarding make it trustworthy.
Reason: Heather runs shows from her laptop and does not use an undiscoverable phone route.

### game-boundaries-must-reset-visible-history
Trigger: Game 2 starts before its first question while phones still hold Game 1 reveal history.
Rule: Scope visible question and reveal state to the active game; show an explicit synchronized starting state when no active-game question exists.
Reason: Historical fallback across game boundaries makes different players see stale right-or-wrong results and mistake the game for frozen.

### original-mode-questions-must-be-text-complete
Trigger: An Original-mode question asks players to identify a pictured sign.
Rule: Certify Original questions without images; generate image-dependent prompts only after the host explicitly selects Visual mode with guaranteed delivery.
Reason: Small, cropped, slow, or failed images otherwise make a valid question unfair for only some players.

### game-mode-is-a-complete-experience
Trigger: Discussing Visual mode as though it were an option inside Original setup.
Rule: Design each selected mode as its own setup, content, certification, live-play, scoring, reveal, recovery, and completion flow.
Reason: Different rules require a coherent player promise, not a hidden content toggle that surprises hosts or players.

### refine-original-build-new-modes-separately
Trigger: Planning Original improvements alongside the first new game mode.
Rule: Apply compatible reliability, fairness, pacing, and readability refinements to Original; build each new mode as a separate end-to-end product flow.
Reason: Rebuilding Original risks Heather's familiar game, while partial mode overlays create inconsistent rules and incomplete screens.

### classic-refinements-require-zero-retraining
Trigger: Planning reliability and experience refinements for Heather's existing Original flow.
Rule: Preserve sequence, controls, and responsibilities; explain visible benefits once, while keeping optional details and new capabilities out of Heather's required path.
Reason: Improvements should remove known pain without making Heather relearn, supervise, or fear the familiar game she already runs.

### north-star-centers-frictionless-use
Trigger: A product North Star overstates “the room” and visually resembles the current product.
Rule: Center intended users completing the experience with minimal effort, uncertainty, waiting, setup, and recovery—not a metaphor or cosmetic restyle.
Reason: Strategic visuals must reveal a meaningfully easier future state, not repackage today’s interface.

### alignment-statements-must-name-observable-behavior
Trigger: Brandon cannot align with a strategy statement because it uses generic product language.
Rule: Name the exact people, device, action, timing, failure protection, and observable success before using North Star language.
Reason: Abstract outcomes hide disagreements; an operating contract exposes them before planning or design proceeds.

### do-not-transfer-routine-product-judgment
Trigger: Brandon is asked to approve a sequence of reversible details that research, code, tests, or prior decisions can answer.
Rule: Decide routine details autonomously and present one consolidated recommendation; ask only genuine business, authority, or irreversible gates.
Reason: Serial approval questions make Brandon perform the agent’s product work and conceal whether the design is actually coherent.

### protect-generated-types-when-local-services-are-offline
Trigger: A type-generation command redirects output while its required local database or Docker service is unavailable.
Rule: Verify dependencies first and generate to a temporary destination before replacing the tracked types file.
Reason: CLI errors can be redirected into the generated file and silently erase valid types.

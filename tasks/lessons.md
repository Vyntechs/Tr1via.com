### touch-audits-must-check-collisions
Trigger: Mobile controls passed size and viewport bounds while overlapping adjacent actions.
Rule: Check pairwise peer overlap across the complete surface after animations settle.
Reason: Individually valid rectangles can still collide and make controls unusable.

### touch-audits-must-discover-controls
Trigger: Mobile accessibility test measured only explicitly tagged controls and missed undersized actions.
Rule: Enumerate from one outer surface wrapper, never fragment IDs; allow only narrow documented exceptions.
Reason: Opt-in selectors and partial roots cannot catch omitted controls.

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

### share-production-generation-budgets
Trigger: Two production-smoke paths used different default generation timeouts.
Rule: Import one timeout source and test each workflow step's explicit budget and total runtime envelope.
Reason: A healthy generator can be deleted and falsely blamed when one harness retains stale limits.

### terminal-generation-state-must-win
Trigger: An async progress observer overwrote needs-attention after partial certified generation stopped.
Rule: Await every durable progress write; never let fire-and-forget writes follow a terminal state.
Reason: Late nonterminal writes hide retry and strand safe checkpoints.

### founder-product-decisions-need-plain-scenarios
Trigger: Brandon cannot understand a product recommendation because it leads with system contracts, invariants, and edge-case tables.
Rule: Explain the ordinary player and host experience first in three plain scenarios; keep implementation mechanics out unless requested.
Reason: Technical completeness is useless when the founder cannot visualize what people will experience.

### reconcile-before-calling-an-answer-missing
Trigger: Network design describes an answer as never arriving without distinguishing an unsent request from a lost confirmation.
Rule: Reconcile against server truth first; label committed, still sending, rejected, and genuinely unsent as separate outcomes.
Reason: Lost acknowledgements are recoverable, while calling them missing misstates severity and undermines player trust.

### browser-device-id-is-not-authorization
Trigger: Shared player data exposed device identifiers while database policies trusted a browser-controlled device header.
Rule: Keep bearer identity private; HMAC-verify mutations server-side and revoke direct anonymous writes.
Reason: A mutable header plus leaked identifier lets one player impersonate another.

### visible-deadline-must-match-accepted-deadline
Trigger: Player controls froze before the server stopped accepting first-time answers.
Rule: Make the official input deadline match server acceptance unless authoritative pre-deadline proof exists.
Reason: A hidden grace period rewards modified clients and breaks fairness.
### phone-host-entry-is-the-product
Trigger: A phone host resumed a live game and received the clipped venue canvas while the usable controller stayed behind a secondary link.
Rule: Device-appropriate hosting must be the primary path; expose venue display as an explicit companion view from the controller.
Reason: Responsive setup means nothing if live-game entry strands the host without controls.

### keep-internal-ledgers-internal
Trigger: Brandon asks why routine progress markdown keeps surfacing during execution.
Rule: Update scratch ledgers only at completed checkpoints; never present them as user deliverables.
Reason: Internal continuity should reduce Brandon's attention cost, not become another stream he must interpret.

### enforce-authoritative-record-ancestry
Trigger: Authoritative tables repeat night, run, game, question, play, or player identifiers.
Rule: Prove shared ancestry with negative database tests and constraints while preserving exact idempotent retries.
Reason: Independently valid foreign keys can still create contradictory state; current-state triggers can break safe retries.

### receipt-before-command-preconditions
Trigger: A retryable command can return stale, invalid, or rejected before recording its command ID.
Rule: Claim and lock the receipt first; persist canonical rejection before returning; calculate deadlines from authoritative receipt timestamps.
Reason: Unrecorded rejection can later apply, and processing order can shorten promised player timing.

### audit-ledgers-are-function-write-only
Trigger: Reset archives canonical receipts or creates immutable run history.
Rule: Deny direct service-role mutation; write through fixed-path functions; test exact retries and full parent-deletion cascades.
Reason: Broad service grants weaken audit truth, while replacement foreign keys can silently break account cleanup.

### test-the-entire-audience-boundary
Trigger: A safe projection is embedded inside a larger player, TV, or public realtime payload.
Rule: Scan the complete wire body and event state for raw identifiers; compose server projections through actual consumers.
Reason: A safe sub-object does not prevent sibling fields, adapters, or broadcasts from leaking identity.

### bind-live-state-to-room-and-request
Trigger: Polls, broadcasts, heartbeats, or overlays can overlap a room change.
Rule: Tag state by room; abort superseded work; reject stale callbacks before sequence changes; never flash previous-room state.
Reason: Async cleanup alone cannot prevent stale events or responses from overwriting the current venue screen.

### database-authors-broadcast-freshness
Trigger: Routes broadcast after retryable database mutations.
Rule: Return freshness outside canonical results; only the transaction winner is fresh; malformed or replayed envelopes fail closed.
Reason: Applied results, revisions, request IDs, and process memory cannot distinguish exact retries safely.

### terminal-receipts-require-results
Trigger: A command receipt changes from pending to applied or rejected.
Rule: Enforce non-null canonical result in schema; unexpected legacy nulls return typed non-fresh corrupt-state without mutation.
Reason: SQL null propagation can erase the envelope and make route broadcast gating ambiguous.

### timebox-final-review-loops
Trigger: Verified implementation remains open for hours while successive broad reviews discover narrow issues.
Rule: Timebox reviewers, batch findings once, fix only blockers, and run one focused re-review before final verification.
Reason: Open-ended review loops waste founder time without proportionally improving safety.

### founder-is-not-the-verification-layer
Trigger: Repository ambiguity causes the agent to ask Brandon to validate or choose a reversible technical preservation step.
Rule: Preserve all states with backup refs or worktrees, complete the safe path, and verify independently.
Reason: Brandon should decide product and release gates, not perform technical verification for the agent.

### name-the-production-release-gate
Trigger: Local integration finishes while the requested production outcome still requires founder-authorized release.
Rule: State that production is unchanged and request exact release approval; never say nothing or stop silently.
Reason: A local checkpoint is not production readiness, and vague status makes Brandon rediscover the remaining work.

### never-autolink-vercel-during-verification
Trigger: A Vercel CLI verification command runs from a worktree without a confirmed existing project link.
Rule: Resolve and verify the existing project and team IDs before CLI use; abort rather than allow automatic linking or project creation.
Reason: Read-only release verification must not create orphan external projects or interrupt the production rollout.
### host-phone-full-workflow-parity
Trigger: Brandon expects a host to create, audit, and run the full game from an iPhone.
Rule: Treat mobile host as a first-class 320–440px workflow, not an optional live-control companion.
Reason: Pocket convenience should make phone hosting painless and nearly preferable to desktop.

### parity-means-familiar-control-not-feature-count
Trigger: Production mobile controls expose actions but make Heather relearn question selection and hunt for desktop tools.
Rule: Preserve the laptop board's mental model on mobile; surface every live host action contextually with no buried control paths.
Reason: Feature availability is not parity when familiar, time-critical show actions become slower or harder to find.

### founder-input-needs-translation-not-vocabulary
Trigger: Brandon describes product intent through venue moments, feelings, pain, or incomplete phrases.
Rule: Translate his raw intent into exact product language, requirements, and visuals; never make him supply professional vocabulary.
Reason: His lived signal is the source; structuring and naming it is the agent's job.

### customer-copy-names-the-actual-thing
Trigger: Product language uses `room` as a generic stand-in for the game, venue, TV, players, audience, or show.
Rule: Use `game` by default; use TV, players, answer, or audience only when more exact. Reserve `room` for invisible internal code symbols.
Reason: Generic container words create questions and force unnecessary interpretation instead of answering what the interface means.

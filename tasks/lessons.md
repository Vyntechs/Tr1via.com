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

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

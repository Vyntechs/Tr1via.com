### closure-narrowing-in-effects
Trigger: Nested async closure captured narrowed nullable id in host live effect.
Rule: Rebind narrowed values to non-null locals before nested closures use them.
Reason: TypeScript does not preserve outer narrowing across nested function boundaries.

### atomic-guarded-resolve
Trigger: App read all-locked eligibility, then called resolve_question separately.
Rule: Put check-and-resolve guards in one DB function with eligibility locks.
Reason: Participants or removals can change between app reads and later RPCs.

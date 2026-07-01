### closure-narrowing-in-effects
Trigger: Nested async closure captured narrowed nullable id in host live effect.
Rule: Rebind narrowed values to non-null locals before nested closures use them.
Reason: TypeScript does not preserve outer narrowing across nested function boundaries.

### respect-prior-approval
Trigger: User said approval for implementation sequence was already granted.
Rule: Do not ask for re-approval when the user states prior approval already covers the task.
Reason: Re-asking slows execution and violates the repo's plan-once workflow.

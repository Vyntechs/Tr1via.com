# Zero-Cost Automatic Production Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every push to `main` from automatically spending Anthropic or Pexels budget while preserving automatic production health and browser checks.

**Architecture:** Keep the existing push-triggered workflow and its deterministic deploy/login/UI checks. Add an explicit manual boolean gate and require it on both steps that invoke real question generation, so paid validation can only run from a deliberate `workflow_dispatch` action.

**Tech Stack:** GitHub Actions YAML, Vitest, Playwright production smoke.

## Global Constraints

- Automatic push validation must make zero Anthropic and zero Pexels calls.
- The deploy health probe and production UI smoke must continue after every push to `main`.
- Real API smoke and full-flow generation remain available only through a manual workflow run with `run_paid_generation: true`.
- Do not call production APIs while implementing or verifying this workflow change.
- Do not alter application code, database schema, secrets, or production data.

---

### Task 1: Gate paid production generation

**Files:**
- Modify: `.github/workflows/prod-smoke.yml`
- Test: `tests/unit/prod-smoke-budget.test.ts`

**Interfaces:**
- Consumes: GitHub event name and the manual `inputs.run_paid_generation` boolean.
- Produces: A push-safe workflow where only explicit manual runs can execute `scripts/prod-smoke.mjs` or `scripts/full-flow-prod.mjs`.

- [x] **Step 1: Write the failing workflow-policy test**

Add a test that requires a boolean `run_paid_generation` input defaulting to false, requires both paid steps to use `if: github.event_name == 'workflow_dispatch' && inputs.run_paid_generation == true`, and confirms the UI smoke remains unguarded by that paid condition.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/prod-smoke-budget.test.ts`

Expected: FAIL because the current workflow runs both generation steps on every push.

- [x] **Step 3: Implement the minimum workflow gate**

Change `workflow_dispatch` to declare:

```yaml
workflow_dispatch:
  inputs:
    run_paid_generation:
      description: Run real Anthropic + Pexels generation (paid)
      required: true
      type: boolean
      default: false
```

Add this condition to both paid steps only:

```yaml
if: github.event_name == 'workflow_dispatch' && inputs.run_paid_generation == true
```

Update workflow comments so push and manual behavior are unambiguous.

- [x] **Step 4: Run focused verification**

Run: `npm test -- tests/unit/prod-smoke-budget.test.ts`

Expected: PASS.

- [x] **Step 5: Run static workflow and repository verification**

Run:

```bash
npx prettier --check .github/workflows/prod-smoke.yml tests/unit/prod-smoke-budget.test.ts
npx tsc --noEmit
npm test
```

Expected: formatting passes, typecheck passes, and the full deterministic test suite passes without external API calls.

- [x] **Step 6: Review and commit**

Inspect the diff to confirm only the workflow, policy test, and this plan changed. Commit with `fix: stop automatic paid production smoke`.

**Rollback:** Revert the single commit; no production data or configuration migration is involved.

**Verified by:** Focused policy test, YAML formatting check, TypeScript check, full deterministic Vitest suite, and diff inspection.

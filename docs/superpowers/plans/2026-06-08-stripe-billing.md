# Stripe Billing — "Trivia Nerd" $4.99/mo (Implementation Record)

**Status:** Code complete on branch `stripe-billing` (off `origin/main`). Unit-verified. Prod migration + Stripe account wiring + live test deferred to merge (see "Remaining" below).

**Goal:** When a self-serve host's 30-day free trial ends, they can pay $4.99/mo via Stripe Checkout and keep generating trivia with AI — cancelling turns it back off. Founder + comped (Heather) hosts are never affected.

> ⚠️ The original brief assumed a *greenfield* paywall. That was stale — it was written against the `june-reactive-water` working tree. `origin/main` had already shipped the free/paid **foundation** (self-serve signup, a 30-day trial, the `hostAIAccess` gate, and the `upgradeRequired:true` 402). This work is the **pay-to-continue layer** on top of that, not a from-scratch paywall. (Lesson logged: research the remote, not the local branch.)

---

## What already existed on `origin/main` (not built here)
- `app/api/auth/host-access` — self-serve signup (the §5.1 "accounts" worry — already done).
- `app/(host)/auth/onboarding-complete` — stamps a 30-day `trial_ends_at` on first host row.
- `supabase/migrations/0010_host_trial.sql` — the `trial_ends_at` column.
- `lib/api/entitlements.ts` — `hostAIAccess(host)`: founder / comped / active-trial → AI on.
- `app/api/categories/[id]/generate/route.ts` — already calls `hostAIAccess`, 402s with "Upgrade to keep generating."
- `lib/api/responses.ts` — `paymentRequired()` already returns `{ error, upgradeRequired: true }`.

## What this branch adds (the payment layer)

| Area | File | Change |
|---|---|---|
| Schema | `supabase/migrations/0011_billing_stripe.sql` | Additive: `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end` on `hosts` (nullable, reversible, no RLS change). |
| Types | `lib/supabase/types.ts` | Hand-synced those 4 columns (interim — a regen confirms at merge). |
| Entitlement | `lib/api/entitlements.ts` | **One new branch**: `subscription_status ∈ {active,trialing,past_due}` → allowed. Order: founder → comped → paid → trial → deny. The generate gate already calls this, so the paid path flows through with **no gate change**. |
| Stripe client | `lib/billing/stripe.ts` | Server-only singleton + monthly price lookup (no hardcoded `apiVersion`). |
| Checkout | `app/api/stripe/checkout/route.ts` | Authed host → ensure+store Stripe customer → subscription Checkout Session (no `payment_method_types`). |
| Webhook | `app/api/stripe/webhook/route.ts` | Raw-body signature verify → idempotent service-role upsert of subscription state on `customer.subscription.{created,updated,deleted}`. The only writer of entitlement. |
| Portal | `app/api/stripe/portal/route.ts` | Authed host → Stripe Customer Portal url (manage/cancel). |
| UI | `components/host/BillingUpgrade.tsx` + `app/host/HostHomeClient.tsx` + `app/host/page.tsx` | Fixed chip (mirrors `FounderChip`): founder/comped → nothing; subscriber → "Manage subscription"; else → "Upgrade · $4.99/mo". |
| Env | `.env.example` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY` (names only). |

## Entitlement model (single source of truth, `hostAIAccess`)
`founder` → ✓ · `is_paywall_bypassed` (comped) → ✓ · `subscription_status ∈ {active, trialing, past_due}` → ✓ · `trial_ends_at` in future → ✓ · else → **deny**. `past_due` stays on for Stripe's dunning grace; `canceled`/`unpaid`/NULL do not. **The founder + comp checks run first and are never replaced — Heather can't be locked out.**

## Decisions (flagged, overridable)
1. **Monthly only** ($4.99/mo) — Brandon's call; no annual, no Stripe free-trial (the trial is the existing local 30-day window).
2. **No `invoice.payment_failed` handler** — `past_due`/`canceled` arrive via `subscription.updated/deleted`; a separate handler would be dead code.
3. **`current_period_end` read from the subscription item** — Stripe SDK 22.x moved it off the subscription root.
4. **Map customer→host by `stripe_customer_id`** (stored at first checkout), not email.
5. **Upgrade UI is a fixed chip** (not woven into `HostDashboard`) — lowest blast radius; avoids that component's pre-existing test fragility.

## Verification done (no Stripe account needed — all mocked)
- `lib/api/entitlements` truth table: **9 tests** (founder/comped/trial/paid/past_due/canceled/boundary).
- Stripe routes: checkout (4), webhook (3, real SDK signature verify + idempotent upsert), portal (3); generate gate +1 paid case.
- `BillingUpgrade` render: **5 tests**.
- **Full suite: 103 files, 624 passed / 8 skipped.** `tsc --noEmit`: 0 errors in new code (2 pre-existing `HostHomeClient-founder-build.test.tsx` errors are unrelated and don't break `next build`/vitest).
- `next build` / `next lint` not run locally — config runs ESLint during build and ESLint crashes in this env (`@eslint/eslintrc`, known issue). The Vercel preview build is the CI gate at push.

## Remaining (at merge / before charging real money)
1. **Apply migration `0011` to prod** (`citweuctcnuxmqjxcbiz`) — additive, reversible. Then `generate_typescript_types` to confirm the hand-synced types match.
2. **Connect the tr1via Stripe account** (the MCP is currently on TalknDone). Create **test-mode** Product "Trivia Nerd" + monthly $4.99 Price; capture the `price_…` id.
3. **Set env** in `.env.local` + Vercel: `STRIPE_SECRET_KEY` (prefer a restricted `rk_`), `STRIPE_PRICE_MONTHLY`, and `STRIPE_WEBHOOK_SECRET` (prod: register the webhook endpoint in Stripe → its signing secret; local: `stripe listen`).
4. **Manual test-mode E2E:** sign in as a non-comped host → "Upgrade" → pay `4242 4242 4242 4242` → confirm the webhook set `subscription_status='active'` → generate AI succeeds → cancel in portal → status flips → generate 402s. Founder + Heather generate throughout.
5. **`scripts/full-flow-prod.mjs`** green (gate is on the game-state path) + the Vercel preview build green.
6. **Go-live (not test mode):** live `rk_` + activated Stripe account (legal entity / ToS — spec §10), Stripe Tax if applicable.

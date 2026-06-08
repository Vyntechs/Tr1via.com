-- 0011_billing_stripe.sql — Stripe subscription columns on hosts.
--
-- The free/paid foundation already exists: hostAIAccess (lib/api/entitlements)
-- grants AI to founder, comped (is_paywall_bypassed), and self-serve hosts
-- inside their 30-day trial (trial_ends_at, 0010_host_trial). What's missing is
-- a way to PAY when the trial ends. These columns hold the Stripe subscription
-- state the webhook writes; hostAIAccess gains a paid branch that reads
-- subscription_status.
--
-- SAFE / ADDITIVE:
--   - Four nullable columns, no default. Every existing host gains four NULLs.
--     Founder/comped/trial paths are untouched — nobody's access changes.
--   - RLS unchanged: hosts_self_read (user_id = auth.uid()) already covers new
--     columns at the row level; the webhook writes via service-role (bypasses
--     RLS). No new grants.
--
-- REVERSIBLE:
--   alter table hosts
--     drop column stripe_customer_id, drop column stripe_subscription_id,
--     drop column subscription_status, drop column current_period_end;

set search_path = public, extensions;

alter table hosts
  add column stripe_customer_id     text,
  add column stripe_subscription_id text,
  add column subscription_status    text,
  add column current_period_end     timestamptz;

comment on column hosts.stripe_customer_id is
  'Stripe Customer ID (cus_…). Set on first checkout; null until billing starts.';
comment on column hosts.stripe_subscription_id is
  'Stripe Subscription ID (sub_…). Null for free-tier / trial / comped hosts.';
comment on column hosts.subscription_status is
  'Mirrors Stripe subscription.status: active | trialing | past_due | canceled | null. Read by hostAIAccess (paid branch).';
comment on column hosts.current_period_end is
  'End of the current paid billing period (display + post-cancel messaging).';

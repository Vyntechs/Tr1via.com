-- 0010_host_trial.sql — self-serve host free trial.
--
-- Until now every hosts row was created one of two ways:
--   1. The founder (hardcoded), or
--   2. A host Brandon comped in via /host/admin (is_paywall_bypassed = true).
-- There was no self-serve path, so there was no concept of a trial.
--
-- New self-serve flow (/api/auth/host-access → /host/onboarding):
-- a brand-new visitor types an email, gets an auth user + session, and
-- the hosts row is created on onboarding-complete with a 30-day trial
-- stamped here. Comped/founder rows leave this NULL — they're bypassed,
-- so a trial window is meaningless for them.
--
-- This migration is SAFE / ADDITIVE:
--   - ADD COLUMN nullable, no default → every existing host row stays NULL
--     (no trial, because they're founder/comped). No data change, no
--     backfill, no behavior change for current hosts.
--
-- NOTE: this column is recorded only. Paywall ENFORCEMENT (what happens
-- when trial_ends_at is in the past) is a deliberately separate, later
-- phase — nothing reads this column yet.

set search_path = public, extensions;

-- When a self-serve host's free trial ends. NULL = no trial window
-- (founder + comped hosts, who are paywall-bypassed anyway).
alter table hosts
  add column trial_ends_at timestamptz;

comment on column hosts.trial_ends_at is
  'End of a self-serve host''s free trial (set at onboarding-complete to ' ||
  'now + 30 days). NULL for founder/comped hosts. Recorded only — paywall ' ||
  'enforcement against this value is a later phase.';

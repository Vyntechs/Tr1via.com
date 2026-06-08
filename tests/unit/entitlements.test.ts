// Unit coverage for the AI paywall gate (lib/api/entitlements).
//
// One pure function decides whether a host may run any AI service. These tests
// pin every branch of that decision so a future refactor can't silently let an
// unpaid host through OR lock out the founder / a comped lifetime host.

import { describe, it, expect } from "vitest";
import { hostAIAccess } from "@/lib/api/entitlements";

// Fixed reference instant so trial windows are deterministic.
const NOW = new Date("2026-06-08T12:00:00.000Z");
const FUTURE = "2026-07-08T12:00:00.000Z"; // 30 days out — active trial
const PAST = "2026-05-08T12:00:00.000Z"; // a month ago — ended trial

type Host = Parameters<typeof hostAIAccess>[0];
const host = (over: Partial<Host>): Host => ({
  role: "host",
  is_paywall_bypassed: false,
  subscription_status: null,
  trial_ends_at: null,
  ...over,
});

describe("hostAIAccess", () => {
  it("allows the founder regardless of trial/bypass", () => {
    expect(
      hostAIAccess(host({ role: "founder", trial_ends_at: PAST }), NOW),
    ).toEqual({ allowed: true });
  });

  it("allows a comped (bypassed) host even with no trial window — lifetime access", () => {
    // The founding customer's row: is_paywall_bypassed = true, trial_ends_at NULL.
    expect(
      hostAIAccess(host({ is_paywall_bypassed: true, trial_ends_at: null }), NOW),
    ).toEqual({ allowed: true });
  });

  it("allows a self-serve host still inside their free trial", () => {
    expect(
      hostAIAccess(host({ trial_ends_at: FUTURE }), NOW),
    ).toEqual({ allowed: true });
  });

  it("blocks a self-serve host whose trial has ended", () => {
    expect(
      hostAIAccess(host({ trial_ends_at: PAST }), NOW),
    ).toEqual({ allowed: false, reason: "not_entitled" });
  });

  it("blocks (deny-by-default) a non-founder, non-comped host with no trial window", () => {
    expect(
      hostAIAccess(host({ trial_ends_at: null }), NOW),
    ).toEqual({ allowed: false, reason: "not_entitled" });
  });

  it("treats the exact trial expiry instant as ended (boundary)", () => {
    expect(
      hostAIAccess(host({ trial_ends_at: NOW.toISOString() }), NOW),
    ).toEqual({ allowed: false, reason: "not_entitled" });
  });

  // --- Paid Stripe subscription: the pay-to-continue layer ---

  it("allows an active paid subscription even after the trial ended", () => {
    expect(
      hostAIAccess(
        host({ subscription_status: "active", trial_ends_at: PAST }),
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  it("keeps AI on for a past_due subscription (Stripe dunning grace)", () => {
    expect(
      hostAIAccess(
        host({ subscription_status: "past_due", trial_ends_at: PAST }),
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  it("blocks a canceled subscription once the trial is also gone", () => {
    expect(
      hostAIAccess(
        host({ subscription_status: "canceled", trial_ends_at: PAST }),
        NOW,
      ),
    ).toEqual({ allowed: false, reason: "not_entitled" });
  });
});

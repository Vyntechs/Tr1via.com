// Render coverage for the host billing chip.
//
// Pins who sees what: founder + comped hosts see nothing; an unsubscribed host
// (on trial or trial-ended) sees "Upgrade"; an active subscriber sees "Manage
// subscription". Render-only (no fetch) — the click path hits Stripe routes
// covered by their own route tests.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillingUpgrade } from "@/components/host/BillingUpgrade";

describe("BillingUpgrade", () => {
  it("renders nothing for the founder", () => {
    const { container } = render(
      <BillingUpgrade isFounder isPaywallBypassed={false} subscriptionStatus={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a comped (lifetime) host", () => {
    const { container } = render(
      <BillingUpgrade isFounder={false} isPaywallBypassed subscriptionStatus={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows Upgrade for an unsubscribed host (trial or ended)", () => {
    render(
      <BillingUpgrade isFounder={false} isPaywallBypassed={false} subscriptionStatus={null} />,
    );
    expect(screen.getByRole("button").textContent).toMatch(/upgrade/i);
  });

  it("shows Manage subscription for an active subscriber", () => {
    render(
      <BillingUpgrade
        isFounder={false}
        isPaywallBypassed={false}
        subscriptionStatus="active"
      />,
    );
    expect(screen.getByRole("button").textContent).toMatch(/manage/i);
  });

  it("treats a canceled subscription as unsubscribed (shows Upgrade)", () => {
    render(
      <BillingUpgrade
        isFounder={false}
        isPaywallBypassed={false}
        subscriptionStatus="canceled"
      />,
    );
    expect(screen.getByRole("button").textContent).toMatch(/upgrade/i);
  });
});

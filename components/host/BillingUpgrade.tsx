// Fixed-position billing chip for the host dashboard. Mirrors FounderChip's
// pattern (a small fixed pill in the corner). Shown only to hosts who could be
// billed: founder + comped (lifetime) hosts never see it. A host with an active
// paid subscription sees "Manage subscription" (→ Stripe Customer Portal);
// everyone else (on trial or trial-ended) sees "Upgrade" (→ Stripe Checkout).
//
// The button opens the relevant Stripe-hosted page by POSTing to our route and
// redirecting to the returned URL — the server is the only thing that ever
// talks to Stripe; entitlement is flipped by the webhook, never the client.

"use client";

import { useState } from "react";

// Statuses that mean "already paying" — keep this in sync with hostAIAccess.
const SUBSCRIBED = new Set(["active", "trialing", "past_due"]);

export function BillingUpgrade({
  isFounder,
  isPaywallBypassed,
  subscriptionStatus,
}: {
  isFounder: boolean;
  isPaywallBypassed: boolean;
  subscriptionStatus: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Founder + comped (lifetime) hosts are never billed → no chip.
  if (isFounder || isPaywallBypassed) return null;

  const subscribed = SUBSCRIBED.has(subscriptionStatus ?? "");
  const path = subscribed ? "/api/stripe/portal" : "/api/stripe/checkout";

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={open}
        disabled={busy}
        style={{
          padding: "8px 14px",
          borderRadius: 999,
          background: busy ? "rgba(0,0,0,.4)" : "var(--accent)",
          color: "#FFF",
          border: "none",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          fontWeight: 700,
          cursor: busy ? "default" : "pointer",
          boxShadow: "0 12px 28px -10px rgba(0,0,0,.5)",
        }}
      >
        {busy
          ? "One sec…"
          : subscribed
            ? "Manage subscription"
            : "Upgrade · $4.99/mo"}
      </button>
      {error && (
        <span
          role="alert"
          style={{
            background: "rgba(156,47,47,.95)",
            color: "#FFF",
            padding: "6px 10px",
            borderRadius: 8,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            maxWidth: 240,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

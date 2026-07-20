// Client wrapper for /host. Owns the CTA handlers (POST /api/nights →
// /host/setup/[nightId]) and renders the right component based on
// `isFirstNightComplete`.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HostDashboard,
  HostWhatsNew,
  ResetGameConfirmModal,
  type HostDashboardPastNight,
  type HostDashboardSetupNight,
  type HostDashboardTonight,
} from "@/components/host";
import { OnboardingFirstDashboard } from "@/components/onboarding";
import { BillingUpgrade } from "@/components/host/BillingUpgrade";
import { hostRunPath } from "@/lib/host/hostRunPath";

const HOST_WHATS_NEW_KEY = "tr1via-host-whats-new-original-v2";

export interface HostHomeClientProps {
  hostName: string;
  hostSubtitle: string;
  defaultVenue: string;
  isFirstNightComplete: boolean;
  isFounder?: boolean;
  isPaywallBypassed?: boolean;
  subscriptionStatus?: string | null;
  previousGames: HostDashboardPastNight[];
  inSetup: HostDashboardSetupNight[];
  lifetime: { nights: number; questions: number };
  tonight: HostDashboardTonight | null;
}

export function HostHomeClient({
  hostName,
  hostSubtitle,
  defaultVenue,
  isFirstNightComplete,
  isFounder = false,
  isPaywallBypassed = false,
  subscriptionStatus = null,
  previousGames,
  inSetup,
  lifetime,
  tonight,
}: HostHomeClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  useEffect(() => {
    if (!isFirstNightComplete) return;
    setWhatsNewOpen(window.localStorage.getItem(HOST_WHATS_NEW_KEY) !== "dismissed");
  }, [isFirstNightComplete]);

  const dismissWhatsNew = useCallback(() => {
    window.localStorage.setItem(HOST_WHATS_NEW_KEY, "dismissed");
    setWhatsNewOpen(false);
  }, []);

  // Founder-only: build a complete real game in one tap (real generation +
  // photos, auto topics + auto-pick) so we can stand up a genuine night to
  // fact-check without manual setup.
  async function buildFullGameAndGo() {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/founder/build-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `build failed (${res.status})`);
      }
      const data = (await res.json()) as { nightId: string };
      router.push(`/host/setup/${data.nightId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the game.");
      setBuilding(false);
    }
  }

  async function createNightAndGo() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/nights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueName: defaultVenue }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `create-night failed (${res.status})`);
      }
      const data = (await res.json()) as { nightId: string };
      router.push(`/host/setup/${data.nightId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the night.");
      setSubmitting(false);
    }
  }

  function goToTonight(nightId: string) {
    if (!tonight) return;
    if (tonight.status === "live") {
      router.push(hostRunPath(nightId));
    } else {
      router.push(`/host/setup/${nightId}`);
    }
  }

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function resetTonight() {
    if (!tonight) return;
    setResetting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(
        `/api/nights/${tonight.nightId}/reset-to-setup`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `reset failed (${res.status})`);
      }
      const data = (await res.json()) as {
        wiped?: { reveals?: number; answers?: number; finishedQuestions?: number; adjustments?: number };
        kept?: { categories?: number; players?: number };
      };
      const wipedAnswers = data.wiped?.answers ?? 0;
      const keptCategories = data.kept?.categories ?? 0;
      const keptPlayers = data.kept?.players ?? 0;
      setSuccessMessage(
        `Game rolled back. Wiped ${wipedAnswers} answers, kept ${keptCategories} categories. The ${keptPlayers} players will see the waiting screen.`,
      );
      setResetOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the game.");
    } finally {
      setResetting(false);
    }
  }

  if (!isFirstNightComplete) {
    return (
      <>
        <OnboardingFirstDashboard
          hostName={hostName.split(" ")[0] ?? hostName}
          venueLabel={defaultVenue}
          onSetup={createNightAndGo}
          isSettingUp={submitting}
        />
        {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
      </>
    );
  }

  return (
    <>
      <HostDashboard
        hostName={hostName}
        hostSubtitle={hostSubtitle}
        previousGames={previousGames}
        inSetup={inSetup}
        lifetime={lifetime}
        tonight={tonight}
        onSetupTonight={createNightAndGo}
        onResume={goToTonight}
        onResetGame={() => setResetOpen(true)}
      />
      {tonight && tonight.resetPreview && (
        <ResetGameConfirmModal
          open={resetOpen}
          venueName={tonight.venue}
          preview={tonight.resetPreview}
          isSubmitting={resetting}
          onConfirm={resetTonight}
          onCancel={() => setResetOpen(false)}
        />
      )}
      {isFounder && <FounderChip />}
      {isFounder && (
        <FounderBuildGameButton onClick={buildFullGameAndGo} busy={building} />
      )}
      <BillingUpgrade
        isFounder={isFounder}
        isPaywallBypassed={isPaywallBypassed}
        subscriptionStatus={subscriptionStatus}
      />
      <button
        type="button"
        onClick={() => setWhatsNewOpen(true)}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 38,
          minHeight: 40,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          cursor: "pointer",
          boxShadow: "0 12px 28px -18px rgba(0,0,0,.6)",
        }}
      >
        What&apos;s new
      </button>
      <HostWhatsNew open={whatsNewOpen} onClose={dismissWhatsNew} />
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
      {successMessage && (
        <SuccessToast
          message={successMessage}
          onDismiss={() => setSuccessMessage(null)}
        />
      )}
    </>
  );
}

function FounderBuildGameButton({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        position: "fixed",
        left: 20,
        bottom: 20,
        zIndex: 40,
        padding: "10px 16px",
        borderRadius: 999,
        background: busy ? "rgba(0,0,0,.4)" : "var(--accent)",
        color: "#FFF",
        border: "none",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        fontWeight: 700,
        cursor: busy ? "default" : "pointer",
        boxShadow: "0 12px 28px -10px rgba(0,0,0,.5)",
      }}
    >
      {busy ? "Building…" : "⚡ Build a full game"}
    </button>
  );
}

function FounderChip() {
  return (
    <Link
      href="/host/admin"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 40,
        padding: "8px 14px",
        borderRadius: 999,
        background: "var(--accent)",
        color: "#FFF",
        textDecoration: "none",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        fontWeight: 700,
        boxShadow: "0 12px 28px -10px rgba(0,0,0,.5)",
      }}
    >
      Founder  →
    </Link>
  );
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 50,
        padding: "12px 16px",
        borderRadius: 10,
        background: "rgba(156,47,47,.95)",
        color: "#FFF",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,.5)",
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "transparent",
          color: "#FFF",
          border: "1px solid rgba(255,255,255,.4)",
          padding: "4px 10px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        right: 20,
        top: 64,
        zIndex: 50,
        padding: "12px 16px",
        borderRadius: 10,
        background: "rgba(60,128,60,.95)",
        color: "#FFF",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,.5)",
        display: "flex",
        gap: 14,
        alignItems: "center",
        maxWidth: 480,
        // Toast is informational — let clicks pass through to the dashboard
        // underneath (e.g. the new "Continue setup" CTA right after a reset).
        // Dismiss button re-enables pointer events for itself.
        pointerEvents: "none",
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "transparent",
          color: "#FFF",
          border: "1px solid rgba(255,255,255,.4)",
          padding: "4px 10px",
          pointerEvents: "auto",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

// Client wrapper for /host. Owns the CTA handlers (POST /api/nights →
// /host/setup/[nightId]) and renders the right component based on
// `isFirstNightComplete`.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HostDashboard, type HostDashboardPastNight, type HostDashboardTonight } from "@/components/host";
import { OnboardingFirstDashboard } from "@/components/onboarding";

export interface HostHomeClientProps {
  hostName: string;
  hostSubtitle: string;
  defaultVenue: string;
  isFirstNightComplete: boolean;
  weeks: HostDashboardPastNight[];
  lifetime: { nights: number; questions: number };
  tonight: HostDashboardTonight | null;
}

export function HostHomeClient({
  hostName,
  hostSubtitle,
  defaultVenue,
  isFirstNightComplete,
  weeks,
  lifetime,
  tonight,
}: HostHomeClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      router.push(`/host/live/${nightId}`);
    } else {
      router.push(`/host/setup/${nightId}`);
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
        weeks={weeks}
        lifetime={lifetime}
        tonight={tonight}
        onSetupTonight={createNightAndGo}
        onResume={goToTonight}
      />
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
    </>
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

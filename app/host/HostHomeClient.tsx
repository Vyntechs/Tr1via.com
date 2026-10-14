// Client wrapper for /host. Owns the CTA handlers (POST /api/nights →
// /host/setup/[nightId]) and renders the right component based on
// `isFirstNightComplete`.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { HOST_NEWS, shouldAutoShowWhatsNew, whatsNewSeenKey } from "@/lib/host/whats-new";

// How long a create tap waits for the request and the page change before the
// button unlocks again.
const CREATE_NIGHT_STALL_MS = 10_000;
const BUILD_GAME_STALL_MS = 60_000;
const CREATE_NIGHT_STALL_MESSAGE =
  "That is taking a while. Tap again; it will not make a second night.";
// A second founder build is a second full game, so this one does not promise
// otherwise.
const BUILD_GAME_STALL_MESSAGE =
  "The build is taking a while. Check your nights below before tapping again; another tap builds a second game.";


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
  // Tap locks. State alone is not enough: two taps can land before React
  // re-renders the disabled button, and each would POST a new night. The ref
  // flips synchronously on the first tap. It stays locked after success,
  // because the page is leaving for the new night's setup screen.
  const createInFlight = useRef(false);
  const buildInFlight = useRef(false);
  // Bar wifi can stall the request, or the move to the new page, with no
  // error at all. So every tap also starts a timer: if the page is still here
  // when it fires, the button unlocks with a plain message. Each tap gets a
  // number, and a late answer from an older tap is ignored once she has
  // tapped again.
  const createAttempt = useRef(0);
  const buildAttempt = useRef(0);
  const createStallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildStallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (createStallTimer.current) clearTimeout(createStallTimer.current);
      if (buildStallTimer.current) clearTimeout(buildStallTimer.current);
    },
    [],
  );

  // If the browser restores this page from its back/forward cache, unlock it
  // so the buttons are not stuck on "Setting up…".
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      createInFlight.current = false;
      buildInFlight.current = false;
      setSubmitting(false);
      setBuilding(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (!isFirstNightComplete) return;
    const seen = window.localStorage.getItem(whatsNewSeenKey(HOST_NEWS)) === "seen";
    setWhatsNewOpen(shouldAutoShowWhatsNew(HOST_NEWS, seen));
  }, [isFirstNightComplete]);

  const dismissWhatsNew = useCallback(() => {
    window.localStorage.setItem(whatsNewSeenKey(HOST_NEWS), "seen");
    setWhatsNewOpen(false);
  }, []);

  // Founder-only: build a complete real game in one tap (real generation +
  // photos, auto topics + auto-pick) so we can stand up a genuine night to
  // fact-check without manual setup.
  async function buildFullGameAndGo() {
    if (buildInFlight.current) return;
    buildInFlight.current = true;
    const attempt = ++buildAttempt.current;
    setBuilding(true);
    setError(null);
    if (buildStallTimer.current) clearTimeout(buildStallTimer.current);
    // A full build makes 12 topics before it answers, so it gets longer than a
    // plain night. Unlocking here does not cancel it; a late answer still
    // opens the night.
    buildStallTimer.current = setTimeout(() => {
      if (buildAttempt.current !== attempt) return;
      buildInFlight.current = false;
      setBuilding(false);
      setError(BUILD_GAME_STALL_MESSAGE);
    }, BUILD_GAME_STALL_MS);
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
      if (buildAttempt.current !== attempt) return;
      router.push(`/host/setup/${data.nightId}`);
    } catch (err) {
      if (buildAttempt.current !== attempt) return;
      if (buildStallTimer.current) clearTimeout(buildStallTimer.current);
      setError(err instanceof Error ? err.message : "Could not build the game.");
      buildInFlight.current = false;
      setBuilding(false);
    }
  }

  async function createNightAndGo() {
    if (createInFlight.current) return;
    createInFlight.current = true;
    const attempt = ++createAttempt.current;
    setSubmitting(true);
    setError(null);
    if (createStallTimer.current) clearTimeout(createStallTimer.current);
    // Tapping again after this is safe: POST /api/nights hands back the empty
    // night the first tap made (same host and venue, last 10 minutes) instead
    // of making a second one.
    createStallTimer.current = setTimeout(() => {
      if (createAttempt.current !== attempt) return;
      createInFlight.current = false;
      setSubmitting(false);
      setError(CREATE_NIGHT_STALL_MESSAGE);
    }, CREATE_NIGHT_STALL_MS);
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
      if (createAttempt.current !== attempt) return;
      router.push(`/host/setup/${data.nightId}`);
    } catch (err) {
      if (createAttempt.current !== attempt) return;
      if (createStallTimer.current) clearTimeout(createStallTimer.current);
      setError(err instanceof Error ? err.message : "Could not create the night.");
      createInFlight.current = false;
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
      // Same number the popup just showed: board slots, so a slot doubled
      // before the one-per-slot fix counts once. The database reply counts
      // every row (and the live-engine reset reply has no count at all).
      const keptCategories =
        tonight.resetPreview?.categoriesKept ?? data.kept?.categories ?? 0;
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

  // A host is "first-time" until she closes her first night, which only
  // happens at the very end of a show. So a brand-new host who starts Game 1
  // and comes back here mid-show is still first-time. The welcome screen has
  // no route back to a live game (its only button sets up a brand-new night),
  // so once her night is live she gets the normal home page instead: the
  // tonight card with "Control live game" (phone) / "Show game on this
  // laptop/TV" (laptop) and the reset option. The extras a returning host sees
  // (What's new, Upgrade) stay off, exactly as on the welcome screen.
  const hasLiveNight = tonight?.status === "live";

  if (!isFirstNightComplete && !hasLiveNight) {
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
        isSettingUp={submitting}
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
      {isFirstNightComplete && (
        <BillingUpgrade
          isFounder={isFounder}
          isPaywallBypassed={isPaywallBypassed}
          subscriptionStatus={subscriptionStatus}
        />
      )}
      {isFirstNightComplete && (
        <WhatsNewButton onClick={() => setWhatsNewOpen(true)} />
      )}
      <HostWhatsNew open={whatsNewOpen} onClose={dismissWhatsNew} news={HOST_NEWS} />
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

function WhatsNewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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

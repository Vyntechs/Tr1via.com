// Thin top-of-screen ribbon that surfaces network trouble. Renders only
// when the connection isn't healthy, so the happy path has zero pixels.
//
// Visual character: amber for recoverable catch-up states, red-ish for
// user-actionable outages. Themed via the current theme tokens so it sits
// inside any palette.

"use client";

import { useTheme } from "@/components/system/ThemeProvider";
import type { ConnectionStatus } from "@/lib/hooks/useConnectionStatus";

export interface ConnectionRibbonProps {
  status: ConnectionStatus;
  /** "unreachable" only: this phone has been cut off long enough that changing
   *  network is worth suggesting. Until then a blip gets the soft line, because
   *  a whole room told to switch networks at once is worse than the blip. */
  showHotspotHint?: boolean;
}

export function ConnectionRibbon({ status, showHotspotHint = false }: ConnectionRibbonProps) {
  const { t } = useTheme();
  if (status === "online") return null;

  const reconnecting = status === "reconnecting";
  const backup = status === "backup";
  const unreachable = status === "unreachable";
  const slow = unreachable && !showHotspotHint;
  // Amber (calm) for the working-but-degraded tiers (backup / reconnecting / a
  // short unreachable spell); red for the user-actionable tiers.
  const calm = backup || reconnecting || slow;
  const bg = calm ? t.pop : t.wrong;
  const label = backup
    ? "Catching up"
    : reconnecting
      ? "Reconnecting…"
      : slow
        ? "Connection's slow"
        : unreachable
          ? "Can't reach the server"
          : "You're offline";
  const tail = backup
    ? "Game is still live. Keep playing; updates may take a moment."
    : reconnecting
      ? "Keep playing. We'll keep sending your answer until time runs out."
      : slow
        ? "We're still trying to reach the game."
        : unreachable
          ? "Switch this device to a hotspot or cellular — it'll reconnect on its own."
          : "Check Wi-Fi or signal. We'll keep sending your answer until time runs out.";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-ribbon"
      data-status={status}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 70,
        background: bg,
        color: t.dark ? "#0E0805" : "#FFF",
        padding: "8px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
        animation: "tr1via-rise .25s cubic-bezier(.2,.7,.3,1) both",
      }}
    >
      {calm && <span aria-hidden="true">⟳</span>}
      {!calm && <span aria-hidden="true">●</span>}
      <span>{label}</span>
      <span
        style={{
          fontWeight: 500,
          letterSpacing: "0.04em",
          textTransform: "none",
          opacity: 0.85,
        }}
      >
        {tail}
      </span>
    </div>
  );
}

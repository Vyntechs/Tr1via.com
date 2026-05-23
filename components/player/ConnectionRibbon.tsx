// Thin top-of-screen ribbon that surfaces network trouble. Renders only
// when the connection isn't healthy, so the happy path has zero pixels.
//
// Visual character: amber for "reconnecting" (recoverable, transient),
// red-ish for "offline" (user-actionable). Themed via the current theme
// tokens so it sits inside any palette.

"use client";

import { useTheme } from "@/components/system/ThemeProvider";
import type { ConnectionStatus } from "@/lib/hooks/useConnectionStatus";

export interface ConnectionRibbonProps {
  status: ConnectionStatus;
}

export function ConnectionRibbon({ status }: ConnectionRibbonProps) {
  const { t } = useTheme();
  if (status === "online") return null;

  const reconnecting = status === "reconnecting";
  const bg = reconnecting ? t.pop : t.wrong;
  const label = reconnecting ? "Reconnecting…" : "You're offline";
  const tail = reconnecting
    ? "We'll send your answer as soon as the signal comes back."
    : "Check Wi-Fi or signal — your answer is held locally until you're back.";

  return (
    <div
      role="status"
      aria-live="polite"
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
      {reconnecting && <span aria-hidden="true">⟳</span>}
      {!reconnecting && <span aria-hidden="true">●</span>}
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

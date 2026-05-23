// Inline "remove player" control for the live console roster.
//
// Two-step interaction: the host taps a small "×" glyph next to a player
// row; the button morphs into a "Remove?" confirm to guard against
// fat-finger mistakes during a live game. Confirm fires the callback;
// any other click (or a 4s idle) resets it. Visual restraint by design
// so the row stays readable.

"use client";

import { useEffect, useRef, useState } from "react";

export interface RemovePlayerButtonProps {
  /** Player display name — used for the aria-label so screen readers know who. */
  playerName: string;
  /** Fired once the host confirms. */
  onConfirm: () => void;
  /** Disable while a request is in flight. */
  disabled?: boolean;
}

const RESET_MS = 4_000;

export function RemovePlayerButton({
  playerName,
  onConfirm,
  disabled = false,
}: RemovePlayerButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timerRef.current = setTimeout(() => setArmed(false), RESET_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [armed]);

  function handleClick() {
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(false);
    onConfirm();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={
        armed ? `Confirm remove ${playerName}` : `Remove ${playerName}`
      }
      style={{
        padding: armed ? "4px 8px" : "2px 6px",
        borderRadius: 6,
        background: armed ? "var(--wrong)" : "transparent",
        color: armed ? "#FFF" : "var(--ink-mute)",
        border: armed ? "none" : "1px solid var(--line-soft)",
        fontFamily: "var(--font-mono)",
        fontSize: armed ? 10 : 12,
        fontWeight: armed ? 700 : 500,
        letterSpacing: armed ? "0.08em" : 0,
        textTransform: armed ? "uppercase" : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        lineHeight: 1,
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {armed ? "Confirm" : "×"}
    </button>
  );
}

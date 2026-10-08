// The status block inside the timer strip on the player phone: "Sending…",
// "Didn't go through — retrying", "Locked in" (then "LOCKED AT 2.3s" once the
// saved row has the real time), "We couldn't confirm your answer", or the
// refusal with its 44 px "Try again". Shared by the in-place tap screen
// (PlayerQuestion) and the stand-alone PlayerLocked so they can never differ.
// Only "locked" claims anything about the answer being counted.

"use client";

import { useTheme, Eyebrow, Numeric } from "@/components/system";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

/** How far this phone's answer has got. */
export type PlayerLockedSendState =
  | "sending"
  | "retrying"
  | "locked"
  | "unconfirmed"
  | "rejected";

/** Height of the status block in every state (the saved-time line is the
 *  tallest). The question screen reserves the same height in its timer strip,
 *  so tapping an answer never changes the strip's height. */
export const SEND_STATUS_MIN_HEIGHT = 49;

export interface PlayerSendStatusProps {
  sendState: PlayerLockedSendState;
  /** `null` = locked but the saved time has not arrived: no time is claimed. */
  msToLock: number | null;
  /** The category colour (dot and time). */
  accent: string;
  /** "rejected" only: lets the player send the same answer again. */
  onRetry?: () => void;
}

export function PlayerSendStatus({ sendState, msToLock, accent, onRetry }: PlayerSendStatusProps) {
  const { t } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const pulseAnimation = reducedMotion ? "none" : "tr1via-pulse 1.4s ease-in-out infinite";
  const isLocked = sendState === "locked";
  const showLockedAt = isLocked && msToLock !== null;
  const secondsToLock = msToLock === null ? "" : (msToLock / 1000).toFixed(1);
  const speedBonus = msToLock !== null && msToLock < 5000;
  const inFlight = sendState === "sending" || sendState === "retrying";
  const offersRetry = sendState === "rejected" && !!onRetry;
  // The two long lines (refusal beside its button, and "Didn't go through —
  // retrying") go without the small label: on a 320 px phone the freed line is
  // what lets them wrap to two lines without growing the strip.
  const showLabel = !offersRetry && sendState !== "retrying";

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: SEND_STATUS_MIN_HEIGHT,
        // With a Try again button the text and the button sit side by side
        // (the button is a real 44 px target inside the reserved height), so
        // this state never grows the strip.
        ...(offersRetry ? { display: "flex", alignItems: "center", gap: 6 } : null),
      }}
      role="status"
      aria-live="polite"
      data-testid="player-send-status"
      data-send-state={sendState}
    >
      {showLockedAt ? (
        <>
          {/* Two short lines, like every other state, so even beside the
              October pumpkin on a 320 px phone they never need a third. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "nowrap" }}>
            <Eyebrow color={t.inkMid} size={9}>LOCKED AT</Eyebrow>
            <Numeric size={15} color={accent}>{secondsToLock}s</Numeric>
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: t.inkMid, fontWeight: 400 }}>
            {speedBonus ? "speed bonus" : "locked in"}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          {showLabel && (
            <Eyebrow color={t.inkMid} size={9}>
              {sendState === "unconfirmed" ? "TIME’S UP" : "YOUR ANSWER"}
            </Eyebrow>
          )}
          <div
            style={{
              marginTop: showLabel ? 2 : 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              lineHeight: 1.2,
              color: sendState === "sending" ? t.inkMid : t.ink,
              fontWeight: 600,
            }}
          >
            {(inFlight || isLocked) && (
              <span
                aria-hidden="true"
                data-testid="player-send-dot"
                style={{
                  flexShrink: 0,
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: isLocked ? accent : t.inkMid,
                  animation: inFlight ? pulseAnimation : "none",
                }}
              />
            )}
            <span>
              {sendState === "sending" && "Sending…"}
              {sendState === "retrying" && "Didn’t go through — retrying"}
              {isLocked && "Locked in"}
              {sendState === "unconfirmed" && "We couldn’t confirm your answer"}
              {sendState === "rejected" && "Couldn’t send your answer"}
            </span>
          </div>
        </div>
      )}
      {offersRetry && !showLockedAt && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            flexShrink: 0,
            minHeight: 44,
            padding: "0 8px",
            background: "none",
            border: "none",
            color: t.ink,
            font: "inherit",
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

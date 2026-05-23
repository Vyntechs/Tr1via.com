// HOST PHONE — UPCOMING. Linda sees the question privately before pressing
// Reveal. The big button on the bottom is the moment that fires the whole
// room.
//
// Wired form: the host-phone route passes the staged question (text +
// options + correctIndex), the category + point value, the room-wide
// counters, and an onReveal handler. All props are optional with demo
// defaults so the /_dev/host gallery still renders.

"use client";

import { PhoneScreen } from "@/components/shells";
import { Eyebrow, Numeric, ThemeProvider, useTheme } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostPhoneUpcomingProps {
  themeKey?: ThemeKey;
  /** Host display name shown in the top-left eyebrow. */
  hostName?: string;
  /** True if the room has open players in it (mirrors the room indicator). */
  roomLive?: boolean;
  /** Current count of players in the room. */
  playerCount?: number;
  /** Category name (e.g. "Geography"). */
  categoryName?: string;
  /** Point value of the staged question. */
  pointValue?: number;
  /** Display index within the night (e.g. 10 of 42). */
  questionIndex?: number;
  /** Total questions in the night (e.g. 42). */
  questionTotal?: number;
  /** The question prompt itself. */
  prompt?: string;
  /** Four options as displayed on the host's phone. */
  options?: [string, string, string, string];
  /** Index of the correct option (host-only view). */
  correctIndex?: 0 | 1 | 2 | 3;
  /** Called when the host taps "Reveal to the room". */
  onReveal?: () => void;
  /** Called when the host taps "Pick a different cell". */
  onPickDifferent?: () => void;
  /** True while the reveal request is in flight (disables the button). */
  isRevealing?: boolean;
}

export function HostPhoneUpcoming(props: HostPhoneUpcomingProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostPhoneUpcomingInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostPhoneUpcomingInner {...rest} />;
}

function HostPhoneUpcomingInner({
  hostName = "Linda",
  roomLive = true,
  playerCount = 32,
  categoryName = "Geography",
  pointValue = 100,
  questionIndex = 10,
  questionTotal = 42,
  prompt = "Which U.S. state has the longest coastline?",
  options = ["Florida", "Alaska", "California", "Maine"],
  correctIndex = 1,
  onReveal,
  onPickDifferent,
  isRevealing = false,
}: Omit<HostPhoneUpcomingProps, "themeKey">) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 6,
          paddingBottom: 14,
        }}
      >
        <Eyebrow color={t.inkMid} size={10}>
          HOST · {hostName.toUpperCase()}
        </Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: roomLive ? t.accent : t.inkMute,
            }}
          />
          <Eyebrow color={t.inkMid} size={10}>
            {roomLive ? `ROOM LIVE · ${playerCount}` : "ROOM CLOSED"}
          </Eyebrow>
        </div>
      </div>

      <div
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          background: t.dark ? "rgba(255,255,255,.04)" : "rgba(20,19,15,.03)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Eyebrow color={t.inkMute} size={9}>
            NEXT FROM THE BOARD
          </Eyebrow>
          <div style={{ marginTop: 4, fontSize: 14, fontWeight: 500, color: t.ink }}>
            {categoryName} · {pointValue} pts
          </div>
        </div>
        <span style={{ fontSize: 11, color: t.inkMid, fontFamily: "var(--font-mono)" }}>
          Q {questionIndex} / {questionTotal}
        </span>
      </div>

      <div style={{ marginTop: 18, padding: "20px 0", borderTop: `1px solid ${t.line}` }}>
        <Eyebrow color={t.accent} size={10}>
          THE QUESTION · TV ONLY
        </Eyebrow>
        <div
          style={{
            marginTop: 10,
            fontSize: 22,
            fontWeight: 500,
            color: t.ink,
            letterSpacing: "-0.015em",
            lineHeight: 1.25,
          }}
        >
          {prompt}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((text, i) => {
          const isCorrect = i === correctIndex;
          return (
            <div
              key={`${i}-${text}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: isCorrect
                  ? t.dark
                    ? "rgba(123,212,154,.10)"
                    : "#EFF7F1"
                  : "transparent",
                border: `1px solid ${isCorrect ? t.correct : t.line}`,
                borderRadius: 10,
              }}
            >
              <Numeric
                size={14}
                color={isCorrect ? t.correct : t.inkMid}
                style={{ minWidth: 12 }}
              >
                {i + 1}
              </Numeric>
              <span
                style={{
                  fontSize: 14,
                  color: isCorrect ? t.correct : t.ink,
                  fontWeight: isCorrect ? 500 : 400,
                  flex: 1,
                }}
              >
                {text}
              </span>
              {isCorrect && (
                <Eyebrow color={t.correct} size={9}>
                  CORRECT
                </Eyebrow>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: t.inkMute, lineHeight: 1.4 }}>
        Players see only the four options on their phone — in a different order each.
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onReveal}
          disabled={isRevealing || !onReveal}
          style={{
            background: t.accent,
            color: t.dark ? "#0E0E0C" : "#FFF",
            border: "none",
            borderRadius: 14,
            padding: "20px 0",
            fontSize: 18,
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            letterSpacing: "-0.01em",
            cursor: isRevealing ? "default" : "pointer",
            opacity: isRevealing ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            boxShadow: t.dark ? "none" : `0 12px 28px -10px ${t.accent}66`,
          }}
        >
          {isRevealing ? "Revealing…" : "Reveal to the room"}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              opacity: 0.7,
              fontWeight: 400,
            }}
          >
            20s
          </span>
        </button>
        <button
          type="button"
          onClick={onPickDifferent}
          style={{
            background: "transparent",
            color: t.inkMid,
            border: `1px solid ${t.line}`,
            borderRadius: 14,
            padding: "14px 0",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          Pick a different cell
        </button>
      </div>
    </PhoneScreen>
  );
}

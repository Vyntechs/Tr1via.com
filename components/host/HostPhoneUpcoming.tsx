// HOST PHONE — UPCOMING. Linda sees the question privately before pressing
// Reveal. The big button on the bottom is the moment that fires the whole
// room.

"use client";

import { PhoneScreen } from "@/components/shells";
import { Eyebrow, Numeric, ThemeProvider, useTheme } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostPhoneUpcomingProps {
  themeKey?: ThemeKey;
}

export function HostPhoneUpcoming({ themeKey }: HostPhoneUpcomingProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostPhoneUpcomingInner />
      </ThemeProvider>
    );
  }
  return <HostPhoneUpcomingInner />;
}

function HostPhoneUpcomingInner() {
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
          HOST · LINDA
        </Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: t.accent }} />
          <Eyebrow color={t.inkMid} size={10}>
            ROOM LIVE · 32
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
            Geography · 100 pts
          </div>
        </div>
        <span style={{ fontSize: 11, color: t.inkMid, fontFamily: "var(--font-mono)" }}>
          Q 10 / 42
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
          Which U.S. state has the longest coastline?
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { n: 1, text: "Florida", correct: false },
          { n: 2, text: "Alaska", correct: true },
          { n: 3, text: "California", correct: false },
          { n: 4, text: "Maine", correct: false },
        ].map((o) => (
          <div
            key={o.n}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              background: o.correct
                ? t.dark
                  ? "rgba(123,212,154,.10)"
                  : "#EFF7F1"
                : "transparent",
              border: `1px solid ${o.correct ? t.correct : t.line}`,
              borderRadius: 10,
            }}
          >
            <Numeric
              size={14}
              color={o.correct ? t.correct : t.inkMid}
              style={{ minWidth: 12 }}
            >
              {o.n}
            </Numeric>
            <span
              style={{
                fontSize: 14,
                color: o.correct ? t.correct : t.ink,
                fontWeight: o.correct ? 500 : 400,
                flex: 1,
              }}
            >
              {o.text}
            </span>
            {o.correct && (
              <Eyebrow color={t.correct} size={9}>
                CORRECT
              </Eyebrow>
            )}
          </div>
        ))}
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
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            boxShadow: t.dark ? "none" : `0 12px 28px -10px ${t.accent}66`,
          }}
        >
          Reveal to the room
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

// HOST PHONE — DURING. Live lock-in count, end-early, undo, and a suspicion
// signal (players who app-switched).

"use client";

import { PhoneScreen } from "@/components/shells";
import { Eyebrow, Numeric, ThemeProvider, TimerRing, useTheme } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostPhoneLiveProps {
  themeKey?: ThemeKey;
}

export function HostPhoneLive({ themeKey }: HostPhoneLiveProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostPhoneLiveInner />
      </ThemeProvider>
    );
  }
  return <HostPhoneLiveInner />;
}

interface PlayerRow {
  name: string;
  t: string;
  flag: string | null;
}

function HostPhoneLiveInner() {
  const { t } = useTheme();
  const players: PlayerRow[] = [
    { name: "Marcus", t: "—", flag: null },
    { name: "Sara", t: "—", flag: null },
    { name: "Eli", t: "—", flag: "app-switched 4m 12s" },
    { name: "Ana", t: "—", flag: null },
    { name: "June", t: "—", flag: null },
    { name: "Lex", t: "—", flag: null },
  ];

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
        <Eyebrow color={t.accent} size={10}>
          QUESTION LIVE
        </Eyebrow>
        <TimerRing seconds={11} size={36} />
      </div>

      <div
        style={{
          padding: "18px 0",
          borderTop: `1px solid ${t.line}`,
          borderBottom: `1px solid ${t.line}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <Eyebrow color={t.inkMid} size={10}>
            LOCKED IN
          </Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <Numeric size={32} weight={500} color={t.ink}>
              21
            </Numeric>
            <span style={{ color: t.inkMid, fontSize: 14 }}>of 32</span>
          </div>
        </div>
        <div
          style={{
            marginTop: 12,
            height: 4,
            borderRadius: 99,
            background: t.line,
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${(21 / 32) * 100}%`, height: "100%", background: t.accent }} />
        </div>
      </div>

      <div style={{ marginTop: 18, flex: 1, overflow: "hidden" }}>
        <Eyebrow color={t.inkMid} size={10}>
          STILL THINKING · 11
        </Eyebrow>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {players.map((p) => (
            <div
              key={p.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: p.flag
                  ? t.dark
                    ? "rgba(229,138,138,.08)"
                    : "rgba(156,47,47,.04)"
                  : "transparent",
              }}
            >
              <span
                style={{ fontSize: 14, color: t.ink, fontWeight: 500, flex: 1 }}
              >
                {p.name}
              </span>
              {p.flag && (
                <Eyebrow color={t.wrong} size={9}>
                  {p.flag}
                </Eyebrow>
              )}
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 99,
                  background: p.flag ? t.wrong : t.inkMute,
                  animation: p.flag ? "none" : "tr1via-pulse 1.6s ease-in-out infinite",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingTop: 12,
          borderTop: `1px solid ${t.line}`,
        }}
      >
        <button
          style={{
            background: "transparent",
            color: t.ink,
            border: `1px solid ${t.line}`,
            borderRadius: 12,
            padding: "14px 0",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <span>End early · reveal now</span>
          <Numeric size={11} color={t.inkMid}>
            10s left
          </Numeric>
        </button>
        <button
          style={{
            background: "transparent",
            color: t.inkMid,
            border: "none",
            borderRadius: 12,
            padding: "6px 0",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          ↺  Undo · pull the question back
        </button>
      </div>
    </PhoneScreen>
  );
}

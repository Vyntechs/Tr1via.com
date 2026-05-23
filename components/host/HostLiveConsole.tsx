// HOST LAPTOP — MID-GAME. Board + live player list + quick controls. This
// mirrors to the TV.

"use client";

import { LaptopShell } from "@/components/shells";
import {
  Eyebrow,
  Numeric,
  ThemeProvider,
  TVTimerArc,
  useTheme,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostLiveConsoleProps {
  themeKey?: ThemeKey;
}

export function HostLiveConsole({ themeKey }: HostLiveConsoleProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostLiveConsoleInner />
      </ThemeProvider>
    );
  }
  return <HostLiveConsoleInner />;
}

interface PlayerRow {
  name: string;
  score: number;
  locked: boolean;
  appOff: string;
  flag?: boolean;
}

const COLUMNS = ["GEOGRAPHY", "ANIMALS", "FOOD", "MOVIES", "MUSIC", "HISTORY"] as const;
const ROWS = [100, 200, 300, 400, 500, 600, 700] as const;

function HostLiveConsoleInner() {
  const { t } = useTheme();
  const players: PlayerRow[] = [
    { name: "Devon", score: 2140, locked: true, appOff: "0s" },
    { name: "Iris", score: 1990, locked: true, appOff: "0s" },
    { name: "Priya", score: 1820, locked: true, appOff: "0s" },
    { name: "Cole", score: 1740, locked: true, appOff: "12s" },
    { name: "Ezra", score: 1610, locked: true, appOff: "0s" },
    { name: "Nadia", score: 1530, locked: true, appOff: "0s" },
    { name: "Maya", score: 1460, locked: true, appOff: "0s" },
    { name: "Theo", score: 1380, locked: true, appOff: "0s" },
    { name: "Jules", score: 1290, locked: false, appOff: "0s" },
    { name: "Marcus", score: 1180, locked: false, appOff: "0s" },
    { name: "Sara", score: 1110, locked: false, appOff: "0s" },
    { name: "Eli", score: 1040, locked: false, appOff: "4m 12s", flag: true },
    { name: "Ana", score: 980, locked: false, appOff: "0s" },
    { name: "June", score: 920, locked: false, appOff: "0s" },
  ];

  return (
    <LaptopShell title="game 1 · live">
      <div
        style={{
          padding: "20px 28px",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 24,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Board mini + question status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <Eyebrow color={t.accent} size={11}>
                QUESTION LIVE · GEOGRAPHY · 100
              </Eyebrow>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 22,
                  color: t.ink,
                  fontWeight: 500,
                  letterSpacing: "-0.015em",
                }}
              >
                Which U.S. state has the longest coastline?
              </div>
            </div>
            <TVTimerArc seconds={11} size={84} />
          </div>

          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gridTemplateRows: "24px repeat(7, 1fr)",
              gap: 6,
            }}
          >
            {COLUMNS.map((c) => (
              <div
                key={c}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: t.dark ? "rgba(255,255,255,.04)" : "rgba(20,19,15,.03)",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: t.ink,
                  textAlign: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {c}
              </div>
            ))}
            {ROWS.map((v, rIdx) =>
              COLUMNS.map((c, cIdx) => {
                const played =
                  (cIdx === 0 && rIdx === 0) ||
                  (cIdx === 0 && rIdx === 1) ||
                  (cIdx === 1 && rIdx === 0) ||
                  (cIdx === 2 && rIdx === 0);
                const live = cIdx === 0 && rIdx === 0;
                return (
                  <div
                    key={`${c}-${v}`}
                    style={{
                      background: live
                        ? t.accent
                        : played
                          ? "transparent"
                          : t.dark
                            ? "rgba(255,255,255,.06)"
                            : t.surface,
                      border: played && !live ? `1px dashed ${t.line}` : "none",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: live
                        ? t.dark
                          ? "#0E0E0C"
                          : "#FFF"
                        : played
                          ? t.inkMute
                          : t.ink,
                      fontFamily: "var(--font-mono)",
                      fontSize: 14,
                      fontWeight: 500,
                      opacity: played && !live ? 0.4 : 1,
                    }}
                  >
                    {v}
                  </div>
                );
              }),
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: t.ink,
                color: t.paper,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              End early · reveal
            </button>
            <button
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: "transparent",
                color: t.ink,
                border: `1px solid ${t.line}`,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              ↺ Undo
            </button>
            <button
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: "transparent",
                color: t.inkMid,
                border: `1px solid ${t.line}`,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              Adjust points
            </button>
            <button
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: "transparent",
                color: t.inkMid,
                border: `1px solid ${t.line}`,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              Pause
            </button>
          </div>
        </div>

        {/* Player list */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              paddingBottom: 12,
              borderBottom: `1px solid ${t.line}`,
            }}
          >
            <Eyebrow color={t.inkMid} size={10}>
              PLAYERS · 32 LIVE
            </Eyebrow>
            <Numeric size={12} color={t.inkMid}>
              21 / 32 in
            </Numeric>
          </div>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {players.map((p, i) => (
              <div
                key={p.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr 70px 18px",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: `1px solid ${t.lineSoft}`,
                  background: p.flag
                    ? t.dark
                      ? "rgba(229,138,138,.05)"
                      : "rgba(156,47,47,.03)"
                    : "transparent",
                  paddingLeft: p.flag ? 8 : 0,
                  paddingRight: p.flag ? 8 : 0,
                  marginLeft: p.flag ? -8 : 0,
                  marginRight: p.flag ? -8 : 0,
                  borderRadius: p.flag ? 6 : 0,
                }}
              >
                <Numeric size={11} color={t.inkMute}>
                  {i + 1}
                </Numeric>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      color: t.ink,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
                  </span>
                  {p.flag && (
                    <span
                      style={{
                        fontSize: 10,
                        color: t.wrong,
                        fontFamily: "var(--font-mono)",
                        marginTop: 1,
                      }}
                    >
                      off-app {p.appOff}
                    </span>
                  )}
                </div>
                <Numeric size={12} color={t.ink} style={{ textAlign: "right" }}>
                  {p.score.toLocaleString()}
                </Numeric>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: p.flag ? t.wrong : p.locked ? t.correct : t.inkMute,
                    opacity: p.locked || p.flag ? 1 : 0.4,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}

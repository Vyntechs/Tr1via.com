// HOST LAPTOP — DASHBOARD. Linda's home base. Sidebar with shortcuts,
// tonight's headliner, and a stack of recent past nights.

"use client";

import { LaptopShell } from "@/components/shells";
import { Eyebrow, Numeric, Rule, ThemeProvider, useTheme } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostDashboardProps {
  themeKey?: ThemeKey;
}

export function HostDashboard({ themeKey }: HostDashboardProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostDashboardInner />
      </ThemeProvider>
    );
  }
  return <HostDashboardInner />;
}

interface PastNight {
  date: string;
  venue: string;
  cats: string[];
  players: number;
  ran: boolean;
}

function HostDashboardInner() {
  const { t } = useTheme();
  const weeks: PastNight[] = [
    {
      date: "Wed May 21",
      venue: "Soul Fire Pizza",
      cats: ["Geography", "Music", "Animals", "Food", "Movies", "History"],
      players: 28,
      ran: true,
    },
    {
      date: "Wed May 14",
      venue: "Soul Fire Pizza",
      cats: ["Sports", "TV", "Science", "U.S. States", "90s", "Local"],
      players: 31,
      ran: true,
    },
    {
      date: "Mon May 12",
      venue: "Mill House Tap",
      cats: ["Beer", "Music", "Geography", "Food", "Movies", "Wild Cards"],
      players: 19,
      ran: true,
    },
    {
      date: "Wed May 7",
      venue: "Soul Fire Pizza",
      cats: ["Movies", "Music", "Animals", "Food", "History", "Sports"],
      players: 26,
      ran: true,
    },
  ];

  return (
    <LaptopShell title="tr1via.com / host">
      <div
        style={{
          padding: "40px 56px",
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: 56,
          flex: 1,
          overflow: "hidden",
        }}
      >
        <div>
          <Eyebrow color={t.inkMute} size={10}>
            HOSTING AS
          </Eyebrow>
          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 500,
              color: t.ink,
              letterSpacing: "-0.015em",
            }}
          >
            Linda Petrov
          </div>
          <div style={{ color: t.inkMid, fontSize: 13, marginTop: 2 }}>
            Independent · 4 venues
          </div>

          <div style={{ marginTop: 36 }}>
            <Eyebrow color={t.inkMute} size={10}>
              SHORTCUTS
            </Eyebrow>
            <div
              style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}
            >
              {["Tonight", "All nights", "Question library", "Themes", "Venues", "Settings"].map(
                (s, i) => (
                  <div
                    key={s}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background:
                        i === 0
                          ? t.dark
                            ? "rgba(255,255,255,.06)"
                            : "rgba(20,19,15,.04)"
                          : "transparent",
                      color: i === 0 ? t.ink : t.inkMid,
                      fontSize: 14,
                      fontWeight: i === 0 ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </div>
                ),
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <div>
              <Eyebrow color={t.accent} size={11}>
                TONIGHT · WED MAY 27
              </Eyebrow>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 44,
                  fontWeight: 500,
                  letterSpacing: "-0.025em",
                  color: t.ink,
                  lineHeight: 1.05,
                }}
              >
                Soul Fire Pizza
                <br />
                <span style={{ color: t.inkMid }}>7:00 — 8:45 pm</span>
              </div>
            </div>
            <button
              style={{
                background: t.accent,
                color: t.dark ? "#0E0E0C" : "#FFF",
                border: "none",
                borderRadius: 12,
                padding: "14px 22px",
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: `0 10px 22px -10px ${t.accent}55`,
              }}
            >
              Set up tonight&apos;s games{" "}
              <span
                style={{ opacity: 0.65, fontFamily: "var(--font-mono)", fontSize: 12 }}
              >
                ~60s
              </span>
            </button>
          </div>

          <div
            style={{
              marginTop: 28,
              padding: "20px 24px",
              borderRadius: 14,
              border: `1px solid ${t.line}`,
              display: "flex",
              gap: 36,
            }}
          >
            <div>
              <Eyebrow color={t.inkMute} size={10}>
                2 GAMES TONIGHT
              </Eyebrow>
              <div style={{ marginTop: 6, fontSize: 18, color: t.ink, fontWeight: 500 }}>
                Each ~50 min · 6 categories × 7 questions
              </div>
            </div>
            <Rule color={t.ink} style={{ width: 1, height: "auto", alignSelf: "stretch" }} />
            <div>
              <Eyebrow color={t.inkMute} size={10}>
                THEME
              </Eyebrow>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 18,
                  color: t.ink,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{ width: 10, height: 10, borderRadius: 99, background: t.accent }}
                />
                May · Storm
              </div>
            </div>
            <Rule color={t.ink} style={{ width: 1, height: "auto", alignSelf: "stretch" }} />
            <div>
              <Eyebrow color={t.inkMute} size={10}>
                ROOM
              </Eyebrow>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 18,
                  color: t.ink,
                  fontWeight: 500,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                }}
              >
                K9 · PR4M
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 36,
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <Eyebrow color={t.inkMute} size={10}>
              YOUR LAST FEW NIGHTS
            </Eyebrow>
            <Eyebrow color={t.inkMute} size={10}>
              78 NIGHTS · 2,140 QUESTIONS
            </Eyebrow>
          </div>

          <div
            style={{
              marginTop: 14,
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              background: t.line,
              borderRadius: 12,
              padding: 1,
            }}
          >
            {weeks.map((w, i) => (
              <div
                key={`${w.date}-${w.venue}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 200px 1fr 100px",
                  alignItems: "center",
                  gap: 18,
                  padding: "16px 18px",
                  background: t.paper,
                  borderRadius:
                    i === 0
                      ? "11px 11px 0 0"
                      : i === weeks.length - 1
                        ? "0 0 11px 11px"
                        : 0,
                }}
              >
                <Numeric size={13} color={t.inkMid}>
                  {w.date}
                </Numeric>
                <span style={{ fontSize: 15, color: t.ink, fontWeight: 500 }}>
                  {w.venue}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                  {w.cats.map((c) => (
                    <span key={c} style={{ fontSize: 12, color: t.inkMid }}>
                      {c}
                    </span>
                  ))}
                </div>
                <div style={{ textAlign: "right" }}>
                  <Numeric size={15} color={t.ink}>
                    {w.players}
                  </Numeric>
                  <span style={{ color: t.inkMute, fontSize: 11 }}> players</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}

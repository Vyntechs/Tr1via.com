// HOST LAPTOP — DASHBOARD. Linda's home base. Sidebar with shortcuts,
// tonight's headliner, and a stack of recent past nights.
//
// Wired form: the (host) layout passes `hostName`, the past nights list, and
// (optionally) a "tonight" night that lights up the headline + makes the CTA
// jump straight back into setup/live. All props are optional with demo
// defaults so the /dev/host gallery still renders.

"use client";

import { LaptopShell } from "@/components/shells";
import { Eyebrow, Numeric, Rule, ThemeProvider, useTheme } from "@/components/system";
import { formatRoomCode } from "@/lib/game/room-code";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostDashboardPastNight {
  /** Formatted display label (e.g. "Wed May 21"). */
  date: string;
  venue: string;
  /** Category names — up to 6 surface, the rest are truncated by CSS. */
  cats: string[];
  /** Distinct players who joined the night. */
  players: number;
  /** True if the night was actually run (vs created and abandoned). */
  ran: boolean;
}

export interface HostDashboardTonight {
  nightId: string;
  venue: string;
  /** Formatted display label (e.g. "Wed May 27"). */
  date: string;
  /** Formatted display label (e.g. "7:00 — 8:45 pm"). */
  timeRange?: string;
  /** Persisted room code; rendered with formatRoomCode for the K9·PR4M look. */
  roomCode: string;
  themeKey: ThemeKey;
  /** "setup" or "live" — drives the headline CTA. */
  status: "setup" | "live" | "done";
}

export interface HostDashboardProps {
  themeKey?: ThemeKey;
  /** Host display name, "Linda Petrov" by default. */
  hostName?: string;
  /** Quick subtitle under the host name. */
  hostSubtitle?: string;
  /** Most-recent-first list of past nights, up to a handful surface. */
  weeks?: HostDashboardPastNight[];
  /** Lifetime totals shown on the right-hand eyebrow. */
  lifetime?: { nights: number; questions: number };
  /** If present, tonight is highlighted with a Set-up/Resume CTA. */
  tonight?: HostDashboardTonight | null;
  /** Called when the host taps the headline CTA. */
  onSetupTonight?: () => void;
  /** Called when the host taps Resume on a live/setup night. */
  onResume?: (nightId: string) => void;
}

export function HostDashboard(props: HostDashboardProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostDashboardInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostDashboardInner {...rest} />;
}

const DEMO_WEEKS: HostDashboardPastNight[] = [
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

function HostDashboardInner({
  hostName = "Linda Petrov",
  hostSubtitle = "Independent · 4 venues",
  weeks = DEMO_WEEKS,
  lifetime,
  tonight = null,
  onSetupTonight,
  onResume,
}: Omit<HostDashboardProps, "themeKey">) {
  const { t } = useTheme();
  const tonightLabel = tonight
    ? `TONIGHT · ${tonight.date.toUpperCase()}`
    : "TONIGHT · WED MAY 27";
  const tonightVenue = tonight?.venue ?? "Soul Fire Pizza";
  const tonightTimeRange = tonight?.timeRange ?? "7:00 — 8:45 pm";
  const lifetimeLabel = lifetime
    ? `${lifetime.nights} NIGHTS · ${lifetime.questions.toLocaleString()} QUESTIONS`
    : "78 NIGHTS · 2,140 QUESTIONS";
  const roomCode = tonight ? formatRoomCode(tonight.roomCode) : "K9 · PR4M";
  const ctaLabel = !tonight
    ? "Set up tonight's games"
    : tonight.status === "live"
      ? "Resume the live game"
      : tonight.status === "done"
        ? "See tonight's recap"
        : "Continue setup";
  function handleCta() {
    if (!tonight) {
      onSetupTonight?.();
      return;
    }
    onResume?.(tonight.nightId);
  }

  return (
    <LaptopShell title="tr1via.com / host">
      <div
        data-testid="host-dashboard"
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
            {hostName}
          </div>
          <div style={{ color: t.inkMid, fontSize: 13, marginTop: 2 }}>
            {hostSubtitle}
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
                {tonightLabel}
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
                {tonightVenue}
                <br />
                <span style={{ color: t.inkMid }}>{tonightTimeRange}</span>
              </div>
            </div>
            <button
              onClick={handleCta}
              data-testid={tonight ? `host-open-room-${tonight.nightId}` : "host-new-night-btn"}
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
              {ctaLabel}
              {!tonight && (
                <span
                  style={{ opacity: 0.65, fontFamily: "var(--font-mono)", fontSize: 12 }}
                >
                  ~60s
                </span>
              )}
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
                {roomCode}
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
              {lifetimeLabel}
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
            {weeks.length === 0 ? (
              <div
                style={{
                  padding: "32px 18px",
                  background: t.paper,
                  borderRadius: 11,
                  color: t.inkMute,
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                No nights yet — your first one will appear here.
              </div>
            ) : (
              weeks.map((w, i) => (
                <div
                  key={`${w.date}-${w.venue}-${i}`}
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
              ))
            )}
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}

// HOST LAPTOP — DASHBOARD. Linda's home base. Sidebar with shortcuts,
// tonight's headliner, and a stack of recent past nights.
//
// Wired form: the (host) layout passes `hostName`, the past nights list, and
// (optionally) a "tonight" night that lights up the headline + makes the CTA
// jump straight back into setup/live. All props are optional with demo
// defaults so the /dev/host gallery still renders.

"use client";

import Link from "next/link";

import { LaptopShell } from "@/components/shells";
import { Eyebrow, Numeric, Rule, ThemeProvider, useTheme } from "@/components/system";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { formatRoomCode } from "@/lib/game/room-code";
import { TR1VIA_THEMES, type ThemeKey } from "@/lib/theme/tokens";
import type { ResetPreview } from "@/lib/api/resetNightCounts";

export interface HostDashboardPastNight {
  nightId: string;
  /** Formatted display label (e.g. "Wed May 21"). */
  date: string;
  venue: string;
  /** Category names — up to 6 surface, the rest are truncated by CSS. */
  cats: string[];
  /** Distinct players who joined the night. */
  players: number;
}

export interface HostDashboardSetupNight {
  nightId: string;
  date: string;
  venue: string;
  cats: string[];
}

export interface HostDashboardTonight {
  nightId: string;
  venue: string;
  /** Formatted display label (e.g. "Wed May 27"). Surfaced in the
   *  "TONIGHT · WED MAY 27" eyebrow above the venue name. */
  date: string;
  /** Plain-English long-form label (e.g. "Wednesday night"). Surfaced
   *  as a prominent subtitle under the venue. Optional — the venue
   *  stays standalone when missing. */
  dateLong?: string;
  /** True only when this night's date is actually today. Gates the
   *  "TONIGHT" word so a stale, never-closed leftover night doesn't claim
   *  to be tonight. */
  isToday: boolean;
  /** Persisted room code; rendered with formatRoomCode for the K9·PR4M look. */
  roomCode: string;
  themeKey: ThemeKey;
  /** "setup" or "live" — drives the headline CTA. */
  status: "setup" | "live" | "done";
  /** Counts surfaced into ResetGameConfirmModal. Populated server-side
   *  only when the night is in 'live' status; null otherwise. */
  resetPreview?: ResetPreview | null;
}

export interface HostDashboardProps {
  themeKey?: ThemeKey;
  /** Host display name, "Linda Petrov" by default. */
  hostName?: string;
  /** Quick subtitle under the host name. */
  hostSubtitle?: string;
  /** Most-recent-first list of nights that actually ran (opened_at != null) —
   *  shown read-only under "Previous games". */
  previousGames?: HostDashboardPastNight[];
  /** Nights created but never run (opened_at == null) — shown under
   *  "Still in setup" with a "Continue setup" link. */
  inSetup?: HostDashboardSetupNight[];
  /** Lifetime totals shown on the right-hand eyebrow. */
  lifetime?: { nights: number; questions: number };
  /** If present, tonight is highlighted with a Set-up/Resume CTA. */
  tonight?: HostDashboardTonight | null;
  /** Called when the host taps the headline CTA. */
  onSetupTonight?: () => void;
  /** Called when the host taps Resume on a live/setup night. */
  onResume?: (nightId: string) => void;
  /** Called when the host taps "Reset and edit game". Only meaningful
   *  when tonight.status === 'live' and tonight.resetPreview is set. */
  onResetGame?: () => void;
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
    nightId: "demo-1",
    date: "Wed May 21",
    venue: "Soul Fire Pizza",
    cats: ["Geography", "Music", "Animals", "Food", "Movies", "History"],
    players: 28,
  },
  {
    nightId: "demo-2",
    date: "Wed May 14",
    venue: "Soul Fire Pizza",
    cats: ["Sports", "TV", "Science", "U.S. States", "90s", "Local"],
    players: 31,
  },
  {
    nightId: "demo-3",
    date: "Mon May 12",
    venue: "Mill House Tap",
    cats: ["Beer", "Music", "Geography", "Food", "Movies", "Wild Cards"],
    players: 19,
  },
  {
    nightId: "demo-4",
    date: "Wed May 7",
    venue: "Soul Fire Pizza",
    cats: ["Movies", "Music", "Animals", "Food", "History", "Sports"],
    players: 26,
  },
];

function HostDashboardInner({
  hostName = "Linda Petrov",
  hostSubtitle = "Independent · 4 venues",
  previousGames = DEMO_WEEKS,
  inSetup = [],
  lifetime,
  tonight = null,
  onSetupTonight,
  onResume,
  onResetGame,
}: Omit<HostDashboardProps, "themeKey">) {
  const { t, themeKey } = useTheme();
  // Below ~860px the fixed 240px sidebar + main column collapses to a single
  // stacked column, the headline/CTA row stacks, the info card stacks, and the
  // fixed-column night rows become stacked blocks — so nothing is clipped
  // off-screen on a phone. Desktop keeps the exact two-column dashboard.
  const compact = useMediaQuery("(max-width: 860px)");
  const themeName = TR1VIA_THEMES[themeKey].name;
  // Only call it "TONIGHT" when the night is actually today; otherwise show
  // the real date plainly so a stale leftover night can't fake being tonight.
  const tonightLabel = tonight
    ? tonight.isToday
      ? `TONIGHT · ${tonight.date.toUpperCase()}`
      : tonight.date.toUpperCase()
    : "TONIGHT · WED MAY 27";
  const tonightVenue = tonight?.venue ?? "Soul Fire Pizza";
  const lifetimeLabel = lifetime
    ? `${lifetime.nights} NIGHTS · ${lifetime.questions.toLocaleString()} QUESTIONS`
    : "78 NIGHTS · 2,140 QUESTIONS";
  const roomCode = tonight ? formatRoomCode(tonight.roomCode) : "K9 · PR4M";
  const ctaLabel = !tonight
    ? "Set up tonight's games"
    : tonight.status === "live"
      ? compact
        ? "Control live game"
        : "Show game on this laptop/TV"
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
    <LaptopShell>
      <div
        data-testid="host-dashboard"
        data-host-mobile-surface="true"
        style={{
          padding: compact ? "24px 20px" : "40px 56px",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "240px 1fr",
          gap: compact ? 24 : 56,
          flex: 1,
          overflow: compact ? "visible" : "hidden",
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

        <div style={{ display: "flex", flexDirection: "column", overflow: compact ? "visible" : "hidden" }}>
          <div
            style={{
              display: "flex",
              flexDirection: compact ? "column" : "row",
              alignItems: compact ? "flex-start" : "flex-end",
              justifyContent: "space-between",
              gap: compact ? 18 : 0,
            }}
          >
            <div>
              <Eyebrow color={t.accent} size={11}>
                {tonightLabel}
              </Eyebrow>
              <div
                style={{
                  marginTop: 8,
                  fontSize: compact ? 32 : 44,
                  fontWeight: 500,
                  letterSpacing: "-0.025em",
                  color: t.ink,
                  lineHeight: 1.05,
                }}
              >
                {tonightVenue}
              </div>
              {tonight?.dateLong && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: t.inkMid,
                    lineHeight: 1.2,
                  }}
                >
                  {tonight.dateLong}
                </div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: compact ? "flex-start" : "flex-end",
                gap: 10,
              }}
            >
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
              {/* Secondary: always-available "+ Plan a new night" so the
                  host isn't stranded behind a single Resume CTA when a
                  test or stale live night is sitting in the slot.
                  Shipped after the first host's session-15 block on a live
                  test night with no escape hatch to set up Wednesday. */}
              {tonight && (
                <button
                  type="button"
                  onClick={() => onSetupTonight?.()}
                  data-testid="host-plan-new-night-btn"
                  style={{
                    background: "transparent",
                    color: t.ink,
                    border: `1px solid ${t.line}`,
                    borderRadius: 10,
                    padding: "9px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1, opacity: 0.7 }}>+</span>
                  Plan a new night
                </button>
              )}
              {tonight && tonight.status === "live" && tonight.resetPreview && (
                <button
                  type="button"
                  onClick={() => onResetGame?.()}
                  data-testid="host-reset-game-btn"
                  style={{
                    background: "transparent",
                    color: t.inkMid,
                    border: `1px solid ${t.line}`,
                    borderRadius: 10,
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: 0.85,
                  }}
                >
                  Reset and edit game
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: 28,
              padding: "20px 24px",
              borderRadius: 14,
              border: `1px solid ${t.line}`,
              display: "flex",
              flexDirection: compact ? "column" : "row",
              gap: compact ? 16 : 36,
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
            {!compact && <Rule color={t.ink} style={{ width: 1, height: "auto", alignSelf: "stretch" }} />}
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
                {themeName}
              </div>
            </div>
            {!compact && <Rule color={t.ink} style={{ width: 1, height: "auto", alignSelf: "stretch" }} />}
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
              PREVIOUS GAMES
            </Eyebrow>
            <Eyebrow color={t.inkMute} size={10}>
              {lifetimeLabel}
            </Eyebrow>
          </div>

          {/* One scroll region wraps BOTH lists so the in-setup rows can
              never be clipped/unreachable under viewport pressure. The
              grouped (t.line hairline) styling lives on the inner wrapper. */}
          <div
            style={{
              marginTop: 14,
              flex: compact ? "none" : 1,
              overflow: compact ? "visible" : "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                background: t.line,
                borderRadius: 12,
                padding: 1,
              }}
            >
              {previousGames.length === 0 ? (
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
                  {inSetup.length > 0
                    ? "No finished games yet — they'll appear here after your first night runs."
                    : "No nights yet — your first one will appear here."}
                </div>
              ) : (
                previousGames.map((w, i) => (
                  <div
                    key={`${w.date}-${w.venue}-${i}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: compact ? "1fr" : "120px 200px 1fr 100px",
                      alignItems: compact ? "start" : "center",
                      gap: compact ? 6 : 18,
                      padding: "16px 18px",
                      background: t.paper,
                      borderRadius:
                        i === 0
                          ? "11px 11px 0 0"
                          : i === previousGames.length - 1
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

            {inSetup.length > 0 && (
              <>
                <div style={{ marginTop: 28 }}>
                  <Eyebrow color={t.inkMute} size={10}>
                    STILL IN SETUP
                  </Eyebrow>
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {inSetup.map((s, i) => (
                    <Link
                      key={`${s.nightId}-${i}`}
                      href={`/host/setup/${s.nightId}`}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: compact ? "1fr" : "120px 200px 1fr auto",
                          alignItems: compact ? "start" : "center",
                          gap: compact ? 6 : 18,
                          padding: "16px 18px",
                          background: t.paper,
                          border: `1px dashed ${t.line}`,
                          borderRadius: 12,
                        }}
                      >
                        <Numeric size={13} color={t.inkMid}>
                          {s.date}
                        </Numeric>
                        <span style={{ fontSize: 15, color: t.ink, fontWeight: 500 }}>
                          {s.venue}
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                          {s.cats.map((c) => (
                            <span key={c} style={{ fontSize: 12, color: t.inkMid }}>
                              {c}
                            </span>
                          ))}
                        </div>
                        <span style={{ color: t.accent, fontSize: 13, fontWeight: 600 }}>
                          Continue setup →
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}

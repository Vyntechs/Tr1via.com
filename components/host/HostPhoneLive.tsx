"use client";

import type { CSSProperties } from "react";
import { PhoneScreen } from "@/components/shells";
import { Eyebrow, ThemeProvider, TimerRing, useTheme } from "@/components/system";
import { readableForeground } from "@/lib/theme/contrast";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostPhoneLivePlayer {
  id: string;
  name: string;
  flag: string | null;
}

export interface HostPhoneLiveProps {
  themeKey?: ThemeKey;
  secondsRemaining?: number;
  lockedCount?: number;
  totalPlayers?: number;
  categoryName?: string;
  pointValue?: number;
  prompt?: string;
  /** Kept for source compatibility; individual players are intentionally not rendered. */
  stillThinking?: HostPhoneLivePlayer[];
  onEndEarly?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  isEnding?: boolean;
}

export function HostPhoneLive({ themeKey, ...props }: HostPhoneLiveProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostPhoneLiveInner {...props} />
      </ThemeProvider>
    );
  }
  return <HostPhoneLiveInner {...props} />;
}

function HostPhoneLiveInner({
  secondsRemaining = 0,
  lockedCount = 0,
  totalPlayers = 0,
  categoryName = "Question",
  pointValue = 0,
  prompt = "Question in progress",
  onEndEarly,
  onUndo,
  canUndo = false,
  isEnding = false,
}: Omit<HostPhoneLiveProps, "themeKey">) {
  const { t } = useTheme();
  const confirmedLocked = Math.max(0, Math.min(lockedCount, totalPlayers));
  const waiting = Math.max(0, totalPlayers - confirmedLocked);
  const pct = totalPlayers > 0 ? (confirmedLocked / totalPlayers) * 100 : 0;
  const panel: CSSProperties = {
    border: `1px solid ${t.line}`,
    borderRadius: 18,
    background: t.surface,
    padding: 16,
  };

  return (
    <PhoneScreen weather={false} style={{ color: t.ink, gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow color={t.accent} size={10}>QUESTION LIVE</Eyebrow>
          <p style={{ margin: "6px 0 0", color: t.inkMid, fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
            {categoryName} · {pointValue} pts
          </p>
        </div>
        <TimerRing seconds={Math.max(0, secondsRemaining)} size={72} />
      </header>

      <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "clamp(24px, 7cqw, 38px)", lineHeight: 1.08, overflowWrap: "anywhere" }}>
        {prompt}
      </h1>

      <section aria-label="Confirmed answers" style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <strong style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>{confirmedLocked} of {totalPlayers} locked</strong>
          <span style={{ color: t.pop, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 800 }}>{waiting} waiting</span>
        </div>
        <div style={{ marginTop: 12, height: 10, borderRadius: 99, background: t.line, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 99, background: t.correct }} />
        </div>
        <p style={{ margin: "10px 0 0", color: t.inkMid, fontSize: 12, lineHeight: 1.4 }}>
          Confirmed answers are counted once. Routine reconnection happens automatically.
        </p>
      </section>

      <section
        role="img"
        aria-label="Expected venue TV question preview — not confirmed"
        style={{ ...panel, padding: 12 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <Eyebrow color={t.accent} size={9}>EXPECTED VENUE TV</Eyebrow>
          <span style={{ color: t.inkMid, fontSize: 11, fontWeight: 750 }}>Venue TV not confirmed</span>
        </div>
        <div style={{ marginTop: 10, aspectRatio: "16 / 7", border: `1px solid ${t.line}`, borderRadius: 12, background: t.paper, display: "grid", placeItems: "center", padding: 12, textAlign: "center", boxSizing: "border-box" }}>
          <div>
            <p style={{ margin: 0, color: t.accent, fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>{categoryName} · {pointValue} pts</p>
            <p style={{ margin: "7px 0 0", fontFamily: "var(--font-display)", fontSize: "clamp(14px, 4cqw, 22px)", fontWeight: 850, lineHeight: 1.08 }}>{prompt}</p>
          </div>
        </div>
      </section>

      <div style={{ marginTop: "auto", display: "grid", gap: 8 }}>
        <button
          type="button"
          onClick={onEndEarly}
          disabled={isEnding || !onEndEarly}
          aria-label={isEnding ? "Ending question early" : `End early · ${Math.max(0, secondsRemaining)} seconds left`}
          style={actionStyle(t.accent, readableForeground(t.accent), isEnding || !onEndEarly)}
        >
          {isEnding ? "Ending…" : "End early · show answer"}
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo || !onUndo}
          style={actionStyle("transparent", canUndo ? t.inkMid : t.inkMute, !canUndo || !onUndo, t.line)}
        >
          ↺ Undo · pull the question back
        </button>
      </div>
    </PhoneScreen>
  );
}

function actionStyle(background: string, color: string, disabled: boolean, border?: string): CSSProperties {
  return {
    width: "100%",
    minWidth: 48,
    minHeight: 48,
    padding: "10px 14px",
    border: `1px solid ${border ?? background}`,
    borderRadius: 14,
    background,
    color,
    font: "inherit",
    fontSize: 13,
    fontWeight: 850,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.52 : 1,
  };
}

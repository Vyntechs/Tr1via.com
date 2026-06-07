// HOST PHONE — DURING. Live lock-in count, end-early, undo, and a suspicion
// signal (players who app-switched).
//
// Wired form: the host-phone route passes the lock-in counts, the still-
// thinking roster, the seconds remaining, and the four control handlers.
// All props are optional with demo defaults so the /dev/host gallery
// still renders.

"use client";

import { PhoneScreen } from "@/components/shells";
import { Eyebrow, Numeric, ThemeProvider, TimerRing, useTheme } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostPhoneLivePlayer {
  id: string;
  name: string;
  /** Optional flag line under the name (e.g. "app-switched 4m 12s"). */
  flag: string | null;
}

export interface HostPhoneLiveProps {
  themeKey?: ThemeKey;
  /** Seconds remaining on the question (0..max, where max is theme-derived: 30 for every theme). */
  secondsRemaining?: number;
  /** Players locked in for the live question. */
  lockedCount?: number;
  /** Total players checked into the night. */
  totalPlayers?: number;
  /** Players who haven't locked yet. */
  stillThinking?: HostPhoneLivePlayer[];
  /** End-early the question now. */
  onEndEarly?: () => void;
  /** Undo the most recent reveal (only enabled within 2s). */
  onUndo?: () => void;
  /** True while the 2s undo window is still open. */
  canUndo?: boolean;
  /** True while an end-early request is in flight. */
  isEnding?: boolean;
}

export function HostPhoneLive(props: HostPhoneLiveProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostPhoneLiveInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostPhoneLiveInner {...rest} />;
}

const DEMO_STILL_THINKING: HostPhoneLivePlayer[] = [
  { id: "p1", name: "Marcus", flag: null },
  { id: "p2", name: "Sara", flag: null },
  { id: "p3", name: "Eli", flag: "app-switched 4m 12s" },
  { id: "p4", name: "Ana", flag: null },
  { id: "p5", name: "June", flag: null },
  { id: "p6", name: "Lex", flag: null },
];

function HostPhoneLiveInner({
  secondsRemaining = 11,
  lockedCount = 21,
  totalPlayers = 32,
  stillThinking = DEMO_STILL_THINKING,
  onEndEarly,
  onUndo,
  canUndo = false,
  isEnding = false,
}: Omit<HostPhoneLiveProps, "themeKey">) {
  const { t } = useTheme();
  const pct = totalPlayers > 0 ? Math.min(100, (lockedCount / totalPlayers) * 100) : 0;
  const remaining = Math.max(0, totalPlayers - lockedCount);
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
        <TimerRing seconds={secondsRemaining} size={36} />
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
              {lockedCount}
            </Numeric>
            <span style={{ color: t.inkMid, fontSize: 14 }}>of {totalPlayers}</span>
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
          <div style={{ width: `${pct}%`, height: "100%", background: t.accent }} />
        </div>
      </div>

      <div style={{ marginTop: 18, flex: 1, overflow: "hidden" }}>
        <Eyebrow color={t.inkMid} size={10}>
          STILL THINKING · {remaining}
        </Eyebrow>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {stillThinking.map((p) => (
            <div
              key={p.id}
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
          type="button"
          onClick={onEndEarly}
          disabled={isEnding || !onEndEarly}
          style={{
            background: "transparent",
            color: t.ink,
            border: `1px solid ${t.line}`,
            borderRadius: 12,
            padding: "14px 0",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            cursor: isEnding ? "default" : "pointer",
            opacity: isEnding ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <span>{isEnding ? "Ending…" : "End early · reveal now"}</span>
          <Numeric size={11} color={t.inkMid}>
            {secondsRemaining}s left
          </Numeric>
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          style={{
            background: "transparent",
            color: canUndo ? t.inkMid : t.inkMute,
            border: "none",
            borderRadius: 12,
            padding: "6px 0",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            cursor: canUndo ? "pointer" : "not-allowed",
            opacity: canUndo ? 1 : 0.5,
          }}
        >
          ↺  Undo · pull the question back
        </button>
      </div>
    </PhoneScreen>
  );
}

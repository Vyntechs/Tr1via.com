// TV — reveal. A stable theme reading surface with one correct-color answer
// rail, a large fact, and a stationary fastest-five list. Designed for the
// oldest eyes at the farthest table—not for a laptop viewed up close.
//
// Driven by props so the live `/tv/[code]` route can paint the actual answer
// and the actual fastest-five from `answers`. Demo defaults preserved for
// `/dev/tv`.

"use client";

import { TVStage } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
  Wordmark,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVRevealFastest {
  name: string;
  /** Pre-formatted lock-in time, e.g. "1.2s". */
  time: string;
  /** Pre-formatted "+110" string. Optional — kept for layout parity. */
  delta?: string;
}

export interface TVRevealProps {
  themeKey?: ThemeKey;
  /** Header eyebrow, e.g. "GAME 1 · GEOGRAPHY · 100 PTS". */
  headerEyebrow?: string;
  /** Question prompt rendered in the muted-on-correct heading area. */
  question?: string;
  /** Number that prints in massive ink for the correct option (1-4). */
  correctNumber?: number;
  /** Text of the correct option. */
  correctText?: string;
  /** Optional fact blurb under the answer. */
  fact?: string;
  /** Total players who got it right out of the room. */
  gotIt?: number;
  /** Denominator of the room. */
  ofTotal?: number;
  /** Fastest single correct lock-in time, e.g. "1.2s". */
  fastest?: string;
  /** Speed bonus awarded for the leader, e.g. "+10". */
  speedBonus?: string;
  /** Top 5 fastest correct answers. */
  fastestFive?: TVRevealFastest[];
}

export function TVReveal({ themeKey, ...rest }: TVRevealProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVRevealInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVRevealInner {...rest} />;
}

export const DEMO_FASTEST: TVRevealFastest[] = [
  { name: "Devon", time: "1.2s", delta: "+110" },
  { name: "Iris",  time: "1.4s", delta: "+110" },
  { name: "Maya",  time: "2.3s", delta: "+110" },
  { name: "Cole",  time: "2.8s", delta: "+110" },
  { name: "Priya", time: "3.1s", delta: "+110" },
];

function TVRevealInner({
  headerEyebrow = "",
  question = "",
  correctNumber = 1,
  correctText = "",
  fact = "",
  gotIt = 0,
  ofTotal = 0,
  fastest = "—",
  speedBonus = "",
  fastestFive = [],
}: Omit<TVRevealProps, "themeKey">) {
  const { t } = useTheme();

  return (
    <TVStage
      data-testid="tv-reveal"
      data-reading-surface="theme-paper"
      weather={false}
    >
      <div
        data-testid="tv-reveal-header"
        style={{
          padding: "clamp(22px, 2vw, 32px) clamp(36px, 3vw, 64px) 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Wordmark size={24} accent={t.correct} ink={t.ink} />
          <span style={{ width: 1, height: 18, background: t.line }} />
          <Eyebrow color={t.inkMid} size={12}>{headerEyebrow}</Eyebrow>
        </div>
        <Eyebrow color={t.correct} size={12}>CORRECT ANSWER</Eyebrow>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "clamp(20px, 2.2vw, 36px) clamp(36px, 3vw, 64px) clamp(26px, 2.4vw, 44px)",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.45fr) minmax(360px, .75fr)",
          gap: "clamp(34px, 4vw, 72px)",
          position: "relative",
          zIndex: 1,
          overflow: "hidden",
        }}
      >
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Display
            size="clamp(36px, 5vmin, 54px)"
            color={t.ink}
            weight={560}
            tracking={-0.025}
            style={{ lineHeight: 1.02 }}
          >
            {question.split("\n").map((line, i, arr) => (
              <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
              </span>
            ))}
          </Display>

          <div
            data-testid="tv-reveal-answer-card"
            style={{
              marginTop: "clamp(22px, 2.5vw, 42px)",
              display: "flex",
              alignItems: "center",
              gap: "clamp(20px, 2vw, 36px)",
              minWidth: 0,
              padding: "clamp(18px, 1.8vw, 30px) clamp(24px, 2.2vw, 40px)",
              borderRadius: 18,
              border: `1px solid ${t.line}`,
              borderLeft: `14px solid ${t.correct}`,
              background: t.surface,
            }}
          >
            <Numeric
              size="clamp(78px, 9vmin, 110px)"
              weight={700}
              color={t.correct}
              tracking={-0.05}
              style={{ lineHeight: 0.82, flex: "none" }}
            >
              {correctNumber}
            </Numeric>
            <span data-testid="tv-reveal-correct" style={{ minWidth: 0 }}>
              <Display
                size="clamp(64px, 8vmin, 100px)"
                color={t.ink}
                weight={700}
                style={{ lineHeight: 0.9, overflowWrap: "anywhere" }}
              >
                {correctText}
              </Display>
            </span>
          </div>

          {fact && (
            <div
              data-testid="tv-reveal-fact"
              style={{
                marginTop: "clamp(18px, 2vw, 32px)",
                fontSize: "clamp(30px, 3.5vmin, 38px)",
                color: t.ink,
                lineHeight: 1.28,
                maxWidth: 880,
                fontWeight: 560,
              }}
            >
              {fact}
            </div>
          )}

          <div
            data-testid="tv-reveal-stats"
            style={{
              marginTop: "auto",
              paddingTop: "clamp(22px, 2.2vw, 38px)",
              display: "flex",
              gap: "clamp(34px, 4vw, 72px)",
            }}
          >
            <div>
              <Eyebrow color={t.inkMute} size={11}>GOT IT</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "clamp(36px, 4vmin, 44px)",
                  fontWeight: 700,
                  color: t.ink,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {gotIt}
                <span style={{ fontSize: 24, fontWeight: 500, color: t.inkMid }}> / {ofTotal}</span>
              </div>
            </div>
            <div>
              <Eyebrow color={t.inkMute} size={11}>FASTEST</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "clamp(36px, 4vmin, 44px)",
                  fontWeight: 700,
                  color: t.ink,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {fastest}
              </div>
            </div>
            <div>
              <Eyebrow color={t.inkMute} size={11}>SPEED BONUS</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "clamp(36px, 4vmin, 44px)",
                  fontWeight: 700,
                  color: t.ink,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {speedBonus}
              </div>
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <Eyebrow color={t.inkMute} size={11}>FIRST FIVE IN</Eyebrow>
          <div
            data-testid="tv-reveal-fastest-list"
            style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}
          >
            {fastestFive.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 14,
                  padding: "clamp(14px, 1.2vw, 20px) clamp(16px, 1.4vw, 24px)",
                  background: t.surface,
                  color: t.ink,
                  borderRadius: 12,
                  border: `2px solid ${i === 0 ? t.correct : t.line}`,
                }}
              >
                <Numeric
                  size={24}
                  weight={700}
                  color={i === 0 ? t.correct : t.inkMid}
                >
                  {i + 1}
                </Numeric>
                <span
                  data-testid="tv-reveal-fastest-name"
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "clamp(28px, 3vmin, 34px)",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {p.name}
                </span>
                <Numeric
                  size="clamp(22px, 2.4vmin, 28px)"
                  weight={600}
                  color={i === 0 ? t.correct : t.inkMid}
                >
                  {p.time}
                </Numeric>
              </div>
            ))}
            {fastestFive.length === 0 && (
              <div style={{ fontSize: 24, color: t.inkMid }}>
                Nobody locked in yet.
              </div>
            )}
          </div>
        </div>
      </div>

    </TVStage>
  );
}

// Player phone — REVEAL · WRONG.
// Warm, never punitive. The pick is shown in the "wrong" state, then the
// missed correct answer is shown right below with the dashed callout. Score
// rail at the bottom shows the player didn't actually move — no points lost.

"use client";

import {
  useTheme,
  Display,
  Eyebrow,
  Numeric,
  AnswerCard,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerRevealWrongProps {
  themeKey?: ThemeKey;
  category?: string;
  value?: number;
  /** Slot (1..4) the player picked. Pass `null` for "no answer". */
  chosenSlot?: 1 | 2 | 3 | 4 | null;
  /** Text of the option the player picked. Ignored when chosenSlot is null. */
  chosenText?: string;
  /** Slot (1..4) the correct answer was in for this player's scramble. */
  correctSlot?: 1 | 2 | 3 | 4;
  /** Text of the canonical correct answer. */
  correctText?: string;
  /** Player's 1-based rank (post-question). `null` when not yet known
   *  (game_scores still loading, or player missing from the view) — header
   *  drops the position chip and the footer shows "in the mix" instead of
   *  "#0". */
  rank?: number | null;
  /** Player's running score. */
  totalScore?: number;
}

export function PlayerRevealWrong({
  themeKey: _themeKey,
  category = "Geography",
  value = 100,
  chosenSlot = 1,
  chosenText = "Florida",
  correctSlot = 2,
  correctText = "Alaska",
  rank = 11,
  totalScore = 2230,
}: PlayerRevealWrongProps = {}) {
  const { t } = useTheme();
  const noAnswer = chosenSlot === null;
  const hasRank = rank !== null && rank !== undefined && rank > 0;
  return (
    <PhoneScreen data-testid="player-reveal-wrong">
      <PhoneHeader
        eyebrow={`${category.toUpperCase()} · ${value} PTS`}
        score={totalScore}
        position={hasRank ? `#${rank}` : undefined}
      />

      <div role="alert" aria-live="assertive">
        <Display size={64} color={t.ink}>
          <span style={{ color: t.inkMid }}>{noAnswer ? "Time's" : "Not this"}</span>
          <br />
          {noAnswer ? "up." : "one."}
        </Display>
      </div>
      <div style={{ marginTop: 10, color: t.inkMid, fontSize: 14, lineHeight: 1.4 }}>
        No points lost — that&apos;s not how this game treats you.
      </div>

      <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 10 }}>
        {!noAnswer && chosenSlot !== null && (
          <AnswerCard n={chosenSlot} text={chosenText} state="wrong" />
        )}
        <Eyebrow color={t.inkMid} size={9} style={{ marginLeft: 4, marginTop: 4 }}>THE ANSWER WAS</Eyebrow>
        <AnswerCard n={correctSlot} text={correctText} state="missed-correct" />
      </div>

      <div
        style={{
          marginTop: "auto",
          padding: "16px 18px",
          borderRadius: 12,
          background: t.surface,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Eyebrow color={t.inkMid} size={10}>POSITION</Eyebrow>
        {hasRank ? (
          <Numeric size={28} weight={600} color={t.ink}>#{rank}</Numeric>
        ) : (
          <Numeric size={18} weight={500} color={t.inkMid}>in the mix</Numeric>
        )}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.inkMute, fontWeight: 500 }}>—</span>
        <span style={{ flex: 1 }} />
        <Numeric size={18} weight={500} color={t.inkMid}>{totalScore.toLocaleString()}</Numeric>
      </div>
    </PhoneScreen>
  );
}

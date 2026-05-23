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
}

export function PlayerRevealWrong({ themeKey: _themeKey }: PlayerRevealWrongProps = {}) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="GEOGRAPHY · 100 PTS" score={2230} position="#11" />

      <Display size={64} color={t.ink}>
        <span style={{ color: t.inkMid }}>Not this</span>
        <br />
        one.
      </Display>
      <div style={{ marginTop: 10, color: t.inkMid, fontSize: 14, lineHeight: 1.4 }}>
        No points lost — that&apos;s not how this game treats you.
      </div>

      <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 10 }}>
        <AnswerCard n={1} text="Florida" state="wrong" />
        <Eyebrow color={t.inkMid} size={9} style={{ marginLeft: 4, marginTop: 4 }}>THE ANSWER WAS</Eyebrow>
        <AnswerCard n={2} text="Alaska" state="missed-correct" />
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
        <Numeric size={28} weight={600} color={t.ink}>#11</Numeric>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.inkMute, fontWeight: 500 }}>&mdash;</span>
        <span style={{ flex: 1 }} />
        <Numeric size={18} weight={500} color={t.inkMid}>2,230</Numeric>
      </div>
    </PhoneScreen>
  );
}

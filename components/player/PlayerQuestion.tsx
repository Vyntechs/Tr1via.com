// Player phone — QUESTION (live).
// The question itself never shows on the phone (TV-only per spec); the phone
// is just the input surface. Saturated category banner + timer ring + four
// chunky answer cards. Per-player numerals are scrambled — caption at bottom
// is the player's reminder that "your 1 isn't Cole's 1".

"use client";

import {
  useTheme,
  Eyebrow,
  PointTag,
  AnswerCard,
  TimerRing,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerQuestionProps {
  themeKey?: ThemeKey;
  seconds?: number;
  category?: string;
  value?: number;
}

export function PlayerQuestion({
  themeKey: _themeKey,
  seconds = 14,
  category = "Geography",
  value = 100,
}: PlayerQuestionProps = {}) {
  const { t } = useTheme();
  const catColor = categoryColor(category, t.accent);
  const opts = [
    { n: 1, text: "Florida" },
    { n: 2, text: "Alaska" },
    { n: 3, text: "California" },
    { n: 4, text: "Maine" },
  ];

  return (
    <PhoneScreen>
      {/* Category banner — full bleed across top */}
      <div
        style={{
          margin: "-14px -22px 18px",
          padding: "14px 22px",
          background: catColor,
          color: "#0E0805",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Eyebrow color="rgba(14,8,5,.65)" size={10}>QUESTION 10 · {category.toUpperCase()}</Eyebrow>
          <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{category}</div>
        </div>
        <PointTag value={value} color="#0E0805" ink={catColor} size="md" />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 10,
          background: t.surface,
          marginBottom: 16,
        }}
      >
        <TimerRing accent={catColor} seconds={seconds} />
        <div style={{ flex: 1, fontSize: 13, color: t.inkMid, fontWeight: 500 }}>
          Read the question on the TV. Tap your answer here.
        </div>
        <Eyebrow color={t.inkMute} size={9}>+10% &lt; 5s</Eyebrow>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {opts.map((o, i) => (
          <AnswerCard key={o.n} accent={catColor} n={o.n} text={o.text} delay={i * 70} />
        ))}
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Eyebrow color={t.inkMute} size={9}>EVERYONE&apos;S #&apos;S ARE SCRAMBLED · YOURS IS YOURS</Eyebrow>
      </div>
    </PhoneScreen>
  );
}

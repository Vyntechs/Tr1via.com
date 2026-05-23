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
import { useAnswerKeyboard } from "@/lib/hooks/useAnswerKeyboard";
import type { ThemeKey } from "@/lib/theme/tokens";

export type PlayerQuestionSlot = 1 | 2 | 3 | 4;

export interface PlayerQuestionProps {
  themeKey?: ThemeKey;
  /** Seconds remaining (already clamped to [0, 20]). */
  seconds?: number;
  category?: string;
  value?: number;
  /**
   * 4 answer strings in the order the player should see them — already in
   * this player's scramble permutation. Slot N below renders options[N-1].
   */
  options?: [string, string, string, string];
  /**
   * Position of the live question within its game (1..N). Powers the
   * "QUESTION 10" eyebrow. Defaults to 10 to match the static preview.
   */
  questionNumber?: number;
  /** Called with the visible slot (1..4) the player tapped. */
  onTap?: (slotChosen: PlayerQuestionSlot) => void;
  /**
   * Disables the answer cards (e.g. while a submit is in-flight). The
   * locked state has its own component (PlayerLocked).
   */
  disabled?: boolean;
}

export function PlayerQuestion({
  themeKey: _themeKey,
  seconds = 14,
  category = "Geography",
  value = 100,
  options = ["Florida", "Alaska", "California", "Maine"],
  questionNumber = 10,
  onTap,
  disabled,
}: PlayerQuestionProps = {}) {
  const { t } = useTheme();
  const catColor = categoryColor(category, t.accent);
  const slots: PlayerQuestionSlot[] = [1, 2, 3, 4];

  useAnswerKeyboard({
    enabled: !!onTap && !disabled,
    onSlot: (slot) => onTap?.(slot),
  });

  return (
    <PhoneScreen data-testid="player-question">
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
          <Eyebrow color="rgba(14,8,5,.65)" size={10}>QUESTION {questionNumber} · {category.toUpperCase()}</Eyebrow>
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
        {slots.map((slot, i) => (
          <AnswerCard
            key={slot}
            accent={catColor}
            n={slot}
            text={options[i] ?? ""}
            delay={i * 70}
            onTap={onTap ? () => onTap(slot) : undefined}
            disabled={disabled}
            data-testid={`player-answer-${slot}`}
          />
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
        <Eyebrow color={t.inkMute} size={9}>KEYBOARD: 1·2·3·4</Eyebrow>
      </div>
    </PhoneScreen>
  );
}

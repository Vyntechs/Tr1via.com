// Player phone — QUESTION (live).
// Saturated category banner → question + thumbnail row → timer strip → four
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
  /**
   * The question prompt text. Renders above the timer strip alongside the
   * thumbnail. When omitted, the question-content row collapses (preserves
   * the legacy TV-only layout for the dev gallery's static preview).
   */
  prompt?: string;
  /**
   * Optional illustration URL (Pexels). Rendered as a 72px square thumbnail
   * to the right of the prompt. Treated as decorative — `alt=""` because
   * the prompt text alone carries the question's semantics.
   */
  imageUrl?: string | null;
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
  // Default prompt + (no image) gives the dev gallery's static preview a
  // realistic look. Real production passes both `question.prompt` and
  // `question.image_url` from the page.
  prompt = "Which U.S. state has the largest land area?",
  imageUrl,
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

      {prompt && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div
            data-testid="player-question-prompt"
            style={{
              flex: 1,
              fontSize: 17,
              fontWeight: 600,
              color: t.ink,
              lineHeight: 1.3,
              letterSpacing: "-0.005em",
              // Cap at ~3 lines so a long prompt can't shove the answer
              // cards off-screen on shorter phones.
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {prompt}
          </div>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- Pexels
            // URLs are external; no /api/image proxy + this is a small,
            // non-LCP decorative thumbnail. Skipping next/image here.
            <img
              src={imageUrl}
              alt=""
              aria-hidden="true"
              data-testid="player-question-image"
              style={{
                width: 72,
                height: 72,
                borderRadius: 10,
                objectFit: "cover",
                flexShrink: 0,
                background: t.surface,
              }}
            />
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 10,
          background: t.surface,
          marginBottom: 14,
        }}
      >
        <TimerRing accent={catColor} seconds={seconds} />
        <span style={{ flex: 1 }} />
        <Eyebrow color={t.inkMute} size={9}>+10% &lt; 5s</Eyebrow>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

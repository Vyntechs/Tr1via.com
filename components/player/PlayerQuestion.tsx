// Player phone — QUESTION (live).
// Saturated category banner → question + thumbnail row → timer strip → four
// chunky answer cards. Per-player numerals are scrambled — caption at bottom
// is the player's reminder that "your 1 isn't Cole's 1".
//
// Sizing model for the prompt text:
//   The question is THE thing being read on a phone in a noisy bar from arm's
//   length. So the prompt claims all available space between the category
//   banner and the timer strip, and `useAutoFitText` picks the largest font
//   that fits — never truncating with "..." and never overflowing into the
//   answer cards. Range: 16px floor (long 160-char prompts) → 28px ceiling
//   (short 21-char prompts). Tested against the prod prompt distribution
//   (p95=126 chars, max=163 chars).

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
import { useAutoFitText } from "@/lib/hooks/useAutoFitText";
import type { ThemeKey } from "@/lib/theme/tokens";

export type PlayerQuestionSlot = 1 | 2 | 3 | 4;

export interface PlayerQuestionProps {
  themeKey?: ThemeKey;
  /** Seconds remaining (already clamped to [0, max] where max is theme-derived: 30 for every theme). */
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

  // Auto-fit the prompt text to the available height. The frame ref attaches
  // to the row that holds the prompt + thumbnail; the text ref attaches to
  // the prompt span. Hook re-measures on orientation change or content swap.
  const { frameRef, textRef, fontSize } = useAutoFitText();

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
          ref={frameRef as React.RefObject<HTMLDivElement>}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 14,
            // Claim all space between the category banner and the timer
            // strip. The four answer cards below already have a fixed
            // height budget (4 × 64px + gaps), so whatever space remains
            // is what the question gets. useAutoFitText picks the largest
            // font-size that fits in this box.
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            ref={textRef as React.RefObject<HTMLDivElement>}
            data-testid="player-question-prompt"
            style={{
              flex: 1,
              fontSize: `${fontSize}px`,
              fontWeight: 600,
              color: t.ink,
              lineHeight: 1.25,
              letterSpacing: "-0.005em",
              // No truncation — `useAutoFitText` guarantees the text fits
              // by shrinking the font, so we never need overflow: hidden
              // or line-clamp here. Wrap normally.
              wordBreak: "break-word",
              hyphens: "auto",
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

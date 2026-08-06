// AnswerCard — the most important atom on the player phone. Five states:
//   idle           — default, tappable
//   locked-self    — this player just picked this answer
//   locked-other   — this player picked something else, so this fades
//   correct        — revealed correct after T+20
//   wrong          — this is what this player picked, but it's wrong
//   missed-correct — the right answer they didn't pick (shown after reveal)
//
// Numeral is in the colored left bar; option text is in the body. The card
// "feels physical" — chunky border, slight scale on lock, accent glow.

"use client";

import type { CSSProperties } from "react";
import { useTheme } from "./ThemeProvider";
import { Numeric } from "./Numeric";

export type AnswerCardState =
  | "idle"
  | "locked-self"
  | "locked-other"
  | "correct"
  | "wrong"
  | "missed-correct";

export interface AnswerCardProps {
  /** Slot number 1-4 shown to this player (NOT the canonical option index). */
  n: number;
  text: string;
  /** Accent color — usually the category color. */
  accent?: string;
  state?: AnswerCardState;
  /** Stagger entrance animation by ms (used for the initial 4-card cascade). */
  delay?: number;
  onTap?: () => void;
  disabled?: boolean;
  /** Forwarded data-testid for E2E targeting. */
  "data-testid"?: string;
}

export function AnswerCard({
  n,
  text,
  accent,
  state = "idle",
  delay = 0,
  onTap,
  disabled,
  "data-testid": dataTestId,
}: AnswerCardProps) {
  const { t } = useTheme();
  const a = accent ?? t.accent;
  const isLockedSelf = state === "locked-self";
  const isLockedOther = state === "locked-other";
  const isCorrect = state === "correct";
  const isWrong = state === "wrong";
  const isMissed = state === "missed-correct";

  let cardBg = t.dark ? "rgba(244,230,196,.04)" : "#FFFFFF";
  let cardBorder = t.line;
  let barBg: string = t.dark ? "rgba(244,230,196,.10)" : "rgba(27,19,12,.05)";
  let barInk: string = t.inkMid;
  let textColor: string = t.ink;
  let opacity = 1;
  let scale = 1;

  if (isLockedSelf) {
    cardBg = t.dark ? "rgba(255,106,61,.10)" : "#FFF1E8";
    cardBorder = a;
    barBg = a;
    barInk = "#FFF";
    scale = 1.0;
  }
  if (isLockedOther) {
    opacity = 0.32;
  }
  if (isCorrect) {
    cardBg = t.dark ? "rgba(200,226,94,.14)" : "#F1F7DC";
    cardBorder = t.correct;
    barBg = t.correct;
    barInk = "#0E0805";
    textColor = t.dark ? t.correct : "#2E4A0E";
  }
  if (isWrong) {
    cardBg = t.dark ? "rgba(229,90,79,.10)" : "#F8E8E5";
    cardBorder = t.wrong;
    barBg = t.wrong;
    barInk = "#FFF";
    textColor = t.dark ? t.wrong : "#7A1C14";
    opacity = 0.95;
  }
  if (isMissed) {
    cardBg = "transparent";
    cardBorder = t.correct;
    barBg = "transparent";
    barInk = t.correct;
    textColor = t.correct;
  }

  const isTappable = state === "idle" && !!onTap && !disabled;

  const Tag = isTappable ? "button" : "div";

  return (
    <Tag
      type={isTappable ? "button" : undefined}
      onClick={isTappable ? onTap : undefined}
      disabled={!isTappable && Tag === "button"}
      data-testid={dataTestId}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        background: cardBg,
        border: `1.5px solid ${cardBorder}`,
        borderRadius: 14,
        overflow: "hidden",
        minHeight: 64,
        opacity,
        transform: `scale(${scale})`,
        transition: "all .35s cubic-bezier(.2,.7,.3,1)",
        animation: `tr1via-rise .5s cubic-bezier(.2,.7,.3,1) ${delay}ms both`,
        cursor: isTappable ? "pointer" : "default",
        textAlign: "left",
        font: "inherit",
        padding: 0,
        width: "100%",
      }}
    >
      <div
        style={{
          width: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: barBg,
          borderRight: isMissed ? `1.5px dashed ${t.correct}` : "none",
        }}
      >
        <Numeric size={26} weight={600} color={barInk} tracking={-0.03}>
          {n}
        </Numeric>
      </div>
      <div style={{ flex: 1, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            flex: 1,
            fontSize: 17,
            fontWeight: 600,
            color: textColor,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          {text}
        </span>
        {isLockedSelf && (
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 99,
              background: a,
              boxShadow: `0 0 0 5px ${a}22`,
            }}
            aria-hidden="true"
          />
        )}
        {isCorrect && (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke={t.correct}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isWrong && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M3 3L11 11M11 3L3 11"
              stroke={t.wrong}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
    </Tag>
  );
}

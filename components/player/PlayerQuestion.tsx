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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useTheme,
  Eyebrow,
  PointTag,
  AnswerCard,
  TimerRing,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { useAnswerKeyboard } from "@/lib/hooks/useAnswerKeyboard";
import { useAutoFitText } from "@/lib/hooks/useAutoFitText";
import type { ThemeKey } from "@/lib/theme/tokens";
import { SeptemberQuestionLampBand } from "@/components/system/SeptemberFront";
import { hasPhoneLayer } from "@/lib/experience/packs";
import { YourPumpkin } from "@/components/experience/october/YourPumpkin";
import type { StandingRow } from "@/lib/player/betweenGames";
import {
  PlayerSendStatus,
  SEND_STATUS_MIN_HEIGHT,
  type PlayerLockedSendState,
} from "./PlayerSendStatus";
import { PlayerLockedStandingsRow } from "./PlayerLocked";

export type PlayerQuestionSlot = 1 | 2 | 3 | 4;

/**
 * The player has tapped an answer. The SAME screen stays up (this component is
 * never swapped for another one): the question text and the four cards keep
 * exactly the places they had, the chosen card highlights, the others dim, and
 * the timer strip's status says Sending… and then Locked in. Nothing is added
 * or removed in the space the question screen already uses, so nothing moves.
 */
export interface PlayerQuestionPick {
  /** Visible slot the server holds / the player tapped. `null` = the server
   *  has an answer but which card is not known yet: no card is marked. */
  chosenSlot: PlayerQuestionSlot | null;
  /** How far the answer has got. */
  sendState: PlayerLockedSendState;
  /** Saved lock time; `null` until the signed row arrives (no time claimed). */
  msToLock: number | null;
  /** "rejected" only: send the same answer again. */
  onRetry?: () => void;
  /** "rejected" only: pick a different card. */
  onPick?: (slot: PlayerQuestionSlot) => void;
  /** Where you stand (as of the last reveal). Sits below the phone's first
   *  screen, reached by scrolling, so showing it can never push the cards. */
  standings?: { top: StandingRow[]; you: StandingRow | null };
}

const NOOP = () => {};

export interface PlayerQuestionProps {
  themeKey?: ThemeKey;
  /** Seconds remaining (already clamped to [0, max] where max is theme-derived: 25 for every theme). */
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
  /** Set once the player has tapped: the same screen, now showing their pick. */
  pick?: PlayerQuestionPick;
  /** Room Magic is on tonight: keeps the "Answer saved." line's space. */
  roomMagicEnabled?: boolean;
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
  pick,
  roomMagicEnabled = false,
}: PlayerQuestionProps = {}) {
  const { t, themeKey } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const catColor = categoryColor(category, t.accent);
  const septemberQuestion = themeKey === "september";
  // October: the player's own unlit pumpkin waits in the timer strip, right
  // above the answers, using space the strip already has.
  const yourPumpkin = hasPhoneLayer(themeKey);
  const bannerBottomGap = septemberQuestion ? 0 : 18;
  const slots: PlayerQuestionSlot[] = [1, 2, 3, 4];
  const [imageFailed, setImageFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const previousSurfaceSize = useRef<{ width: number; height: number } | null>(null);
  const [decorationLevel, setDecorationLevel] = useState(0);
  const finalDecorationLevel = septemberQuestion ? 3 : 2;
  const showFooter = decorationLevel < 1;
  const showLamps = decorationLevel < 2;
  const showImage =
    !!imageUrl &&
    !imageFailed &&
    decorationLevel < (septemberQuestion ? 3 : 2);

  // On a very small phone the question is taller than the screen, so the
  // phone's scroller is taller than the screen too and its bottom sits under
  // the fold. Standings at the end of it would then stay out of a finger's
  // reach. This is how far that bottom hangs below the screen; it is added as
  // padding under the standings only, so nothing above them moves.
  const [belowFold, setBelowFold] = useState(0);
  const hasStandings = !!pick?.standings && pick.standings.top.length > 0;
  useEffect(() => {
    const surface = screenRef.current;
    if (!hasStandings || !surface) return;
    const measure = () => {
      const bottom = surface.getBoundingClientRect().bottom + window.scrollY;
      const next = Math.max(0, Math.ceil(bottom - window.innerHeight));
      setBelowFold((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hasStandings]);

  const handleImageFailure = useCallback(() => {
    setImageFailed(true);
    setDecorationLevel(0);
  }, []);

  useEffect(() => {
    setImageFailed(false);
    setDecorationLevel(0);
  }, [category, imageUrl, prompt, septemberQuestion]);

  useEffect(() => {
    const image = imageRef.current;
    if (!showImage || !image) return;
    if (image.complete && image.naturalWidth === 0) {
      handleImageFailure();
    }
  }, [handleImageFailure, imageUrl, showImage]);

  useEffect(() => {
    const surface = screenRef.current;
    if (!surface) return;

    const initial = surface.getBoundingClientRect();
    previousSurfaceSize.current = { width: initial.width, height: initial.height };
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      const previous = previousSurfaceSize.current;
      previousSurfaceSize.current = next;
      if (
        previous &&
        (next.width > previous.width + 1 || next.height > previous.height + 1)
      ) {
        // Re-evaluate from the richest composition when the mounted phone
        // gains room. If it still cannot fit, the deficit state machine below
        // reapplies only the degradation steps that remain necessary.
        setDecorationLevel(0);
      }
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // After the tap the digit keys only work again if the answer was refused and
  // the player may pick another card.
  const canRepick = pick?.sendState === "rejected" && !!pick.onPick;
  useAnswerKeyboard({
    enabled: pick ? canRepick : !!onTap && !disabled,
    onSlot: (slot) => (pick ? pick.onPick?.(slot) : onTap?.(slot)),
  });
  const pickedLocked = pick?.sendState === "locked";

  // Auto-fit the prompt text to the available height. The frame ref attaches
  // to the row that holds the prompt + thumbnail; the text ref attaches to
  // the prompt span. Hook re-measures on orientation change or content swap.
  const { frameRef, textRef, fontSize, fitDeficit } = useAutoFitText({ fitTolerance: 0 });

  useEffect(() => {
    if (fitDeficit <= 0) return;
    // Preserve the 16px gameplay-text floor and all four answers. Reclaim
    // space in an explicit least-to-most-costly order: the touch-screen
    // keyboard reminder, September's lamp band when present, then the
    // decorative photo (second on themes without the lamp band).
    setDecorationLevel((current) => Math.min(finalDecorationLevel, current + 1));
  }, [finalDecorationLevel, fitDeficit]);

  return (
    <PhoneScreen
      data-testid={pick ? "player-locked" : "player-question"}
      scroll={pick ? "auto" : "locked"}
      weatherPage="question"
      screenRef={screenRef}
      style={{ ["--player-question-decoration-level" as string]: decorationLevel }}
    >
      {/* Category banner — full bleed across top */}
      <div
        style={{
          margin: `-14px -22px ${bannerBottomGap}px`,
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

      {septemberQuestion && showLamps && <SeptemberQuestionLampBand />}

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
          {showImage && (
            // eslint-disable-next-line @next/next/no-img-element -- Pexels
            // URLs are external; no /api/image proxy + this is a small,
            // non-LCP decorative thumbnail. Skipping next/image here.
            <img
              ref={imageRef}
              src={imageUrl}
              alt=""
              aria-hidden="true"
              data-testid="player-question-image"
              onError={handleImageFailure}
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
          // The status text needs this much room; the strip has it from the
          // start, so the tap never changes the strip's height.
          boxSizing: "border-box",
          minHeight: SEND_STATUS_MIN_HEIGHT + 20,
          borderRadius: 10,
          background: t.surface,
          marginBottom: 14,
        }}
      >
        <TimerRing accent={catColor} seconds={seconds} />
        {pick ? (
          <>
            <PlayerSendStatus
              sendState={pick.sendState}
              msToLock={pick.msToLock}
              accent={catColor}
              onRetry={pick.onRetry}
            />
            {yourPumpkin && pick.sendState !== "rejected" ? (
              // (Hidden once the answer is refused: it can no longer light, and
              // its width is what the Try again button needs on a small phone.)
              // October: your pumpkin lights the moment the server says yes.
              <YourPumpkin
                mood={pickedLocked ? "lit" : pick.sendState === "unconfirmed" ? "toppled" : "waiting"}
                size={56}
                style={{ margin: "-18px 0 -8px" }}
              />
            ) : null}
          </>
        ) : (
          <>
            {yourPumpkin ? (
              <span style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <YourPumpkin
                  mood={seconds <= 0 ? "toppled" : "waiting"}
                  shiver={seconds > 0 && seconds <= 5}
                  size={56}
                  style={{ margin: "-18px 0 -8px" }}
                />
              </span>
            ) : (
              <span style={{ flex: 1 }} />
            )}
            <Eyebrow color={t.inkMute} size={9}>+10% &lt; 5s</Eyebrow>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {slots.map((slot, i) => (
          <AnswerCard
            key={slot}
            accent={catColor}
            n={slot}
            text={options[i] ?? ""}
            delay={i * 70}
            entrance="backwards"
            // The same cards before and after the tap: only the look changes.
            // (After a refusal the other answers wake up so the player can
            // change their mind; the refused one stays marked.)
            state={
              !pick
                ? "idle"
                : slot === pick.chosenSlot
                  ? "locked-self"
                  : canRepick
                    ? "idle"
                    : "locked-other"
            }
            reserveMark
            focusOnMount={!!pick && slot === pick.chosenSlot}
            onTap={pick ? (canRepick ? () => pick.onPick?.(slot) : NOOP) : onTap ? () => onTap(slot) : undefined}
            disabled={pick ? false : disabled}
            data-testid={pick ? `player-locked-answer-${slot}` : `player-answer-${slot}`}
          />
        ))}
      </div>

      {roomMagicEnabled && (
        <div
          aria-live="polite"
          data-testid="player-house-lights-confirmation"
          style={{
            marginTop: "auto",
            paddingTop: 10,
            textAlign: "center",
            minHeight: 18,
            boxSizing: "content-box",
            color: t.ink,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {pickedLocked ? "Answer saved." : "\u00A0"}
        </div>
      )}

      {showFooter && (
        <div
          style={{
            marginTop: roomMagicEnabled ? 0 : "auto",
            paddingTop: 14,
            position: "relative",
          }}
        >
          {/* The small print is ALWAYS laid out (hidden after the tap), so the
              footer is exactly as tall in both states and nothing above it
              moves. After the tap the waiting line is laid over it. */}
          <div
            aria-hidden={pick ? true : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              visibility: pick ? "hidden" : "visible",
            }}
          >
            <Eyebrow color={t.inkMute} size={9}>EVERYONE&apos;S #&apos;S ARE SCRAMBLED · YOURS IS YOURS</Eyebrow>
            <Eyebrow color={t.inkMute} size={9}>KEYBOARD: 1·2·3·4</Eyebrow>
          </div>
          {pick && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 14,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              {(pickedLocked || pick.sendState === "sending") && (
                <span
                  data-testid="player-waiting-pulse-dot"
                  style={{
                    flexShrink: 0,
                    width: 5,
                    height: 5,
                    borderRadius: 99,
                    background: catColor,
                    animation: reducedMotion ? "none" : "tr1via-pulse 1.4s ease-in-out infinite",
                  }}
                />
              )}
              <Eyebrow
                color={t.inkMute}
                size={9}
                style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {pickedLocked || pick.sendState === "sending"
                  ? "Waiting for the room to lock in\u2026"
                  : pick.sendState === "retrying"
                    ? "Keep this screen open while we retry."
                    : pick.sendState === "unconfirmed"
                      ? "Waiting for the reveal\u2026"
                      : "\u00A0"}
              </Eyebrow>
            </div>
          )}
        </div>
      )}

      {pick?.standings && pick.standings.top.length > 0 && (
        // Below the phone's first screen: reached by scrolling, positioned
        // outside the flow so it can never take space from the cards.
        <div
          data-testid="player-locked-standings"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            paddingTop: 18,
            paddingBottom: 26 + belowFold,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Eyebrow color={t.inkMute} size={10}>WHERE YOU STAND</Eyebrow>
          {pick.standings.top.map((row) => (
            <PlayerLockedStandingsRow
              key={`${row.rank}-${row.name}`}
              row={row}
              accent={catColor}
              surface={t.surface}
              ink={t.ink}
            />
          ))}
          {pick.standings.you && (
            <PlayerLockedStandingsRow
              row={pick.standings.you}
              pinned
              accent={catColor}
              surface={t.surface}
              ink={t.ink}
            />
          )}
        </div>
      )}
    </PhoneScreen>
  );
}

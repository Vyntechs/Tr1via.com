// TV — question reveal. Bold category banner across the top, big editorial
// question text, four chunky cards underneath showing the scrambled order.
// The TV always shows numbers — each phone gets its own private order
// (scramble enforced server-side).
//
// Live lock-ins are summarized as one stationary count and progress bar. The
// room can feel active without making distant players chase moving names.

"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { TVStage, TVHeader } from "@/components/shells";
import {
  Eyebrow,
  Numeric,
  PointTag,
  ThemeProvider,
  TVTimerArc,
  useTheme,
} from "@/components/system";
import { TVHouseLights } from "@/components/tv/TVHouseLights";
import type { MarqueeChip } from "@/components/tv/TVScoreboardMarquee";
import { useAutoFitText } from "@/lib/hooks/useAutoFitText";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

// Candidate font sizes for the question prompt — picked so that the longest
// real-world prompts (the AI generator caps around 200 chars) still fit inside
// the question region while short prompts get the full editorial hero size.
// The image variant has less horizontal room because the 260px thumbnail
// claims its column, so its ceiling is a notch lower.
const QUESTION_SIZES_NO_IMAGE = [48, 54, 60, 66, 72] as const;
const QUESTION_SIZES_WITH_IMAGE = [48, 54, 60, 66, 72] as const;

export interface TVQuestionOption {
  n: number;
  text: string;
}

export interface TVQuestionTile {
  id: string;
  name: string;
  /** Lock-in time, e.g. "1.2s". Optional. */
  t?: string;
  /** True for the local viewer (highlighted with an outline). */
  isYou?: boolean;
}

export interface TVQuestionProps {
  themeKey?: ThemeKey;
  seconds?: number;
  category?: string;
  value?: number;
  question?: string;
  options?: TVQuestionOption[];
  /** Live lock-ins. Only the count is shown publicly during the question. */
  tiles?: TVQuestionTile[];
  /** Total number of joined players (denominator for "X of Y locked in"). */
  totalPlayers?: number;
  /** Room Magic House Lights are cosmetic aggregate lock-in presence. */
  roomMagicEnabled?: boolean;
  /** Optional deduped count from live answers. House Lights hides when absent. */
  houseLightsLockedCount?: number;
  /** Pexels photo attached during generation. Rendered below the category
   *  banner as a wide thumbnail when present. */
  imageUrl?: string | null;
  // Retained for caller compatibility; Original mode deliberately does not
  // render moving player chips while a question must be read across a venue.
  /** @deprecated Player chips are no longer shown during a question. */
  marqueeChips?: MarqueeChip[];
  /** Player whose chip is spotlighted (just locked in). */
  spotlightedPlayerId?: string | null;
  /** Screen-reader announcement for the latest lock-in event. */
  lockInAnnouncement?: string;
}

export function TVQuestion(props: TVQuestionProps) {
  if (props.themeKey) {
    return (
      <ThemeProvider themeKey={props.themeKey}>
        <TVQuestionInner {...props} />
      </ThemeProvider>
    );
  }
  return <TVQuestionInner {...props} />;
}

function TVQuestionInner({
  seconds = 14,
  category = "Geography",
  value = 100,
  question = "Which U.S. state has the longest coastline?",
  options,
  tiles,
  totalPlayers,
  imageUrl,
  lockInAnnouncement,
  roomMagicEnabled = false,
  houseLightsLockedCount,
}: TVQuestionProps) {
  const { t } = useTheme();
  const cc = categoryColor(category, t.accent);
  const [imageFailed, setImageFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const showImage = !!imageUrl && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const image = imageRef.current;
    if (!showImage || !image) return;
    if (image.complete && image.naturalWidth === 0) {
      setImageFailed(true);
    }
  }, [imageUrl, showImage]);

  // Shrink the prompt only as much as needed to keep the answer cards on
  // screen — the host's HDMI'd laptop drives the venue TV, so the actual
  // pixel viewport varies night to night. Measurement (not media queries) is
  // what guarantees fit.
  const { frameRef, textRef, fontSize: questionFontSize } = useAutoFitText({
    sizes: showImage ? QUESTION_SIZES_WITH_IMAGE : QUESTION_SIZES_NO_IMAGE,
  });
  const opts: TVQuestionOption[] = options ?? [
    { n: 1, text: "Florida" },
    { n: 2, text: "Alaska" },
    { n: 3, text: "California" },
    { n: 4, text: "Maine" },
  ];

  const lockedIn = tiles?.length ?? 21;
  const denominator = totalPlayers ?? 32;
  const houseLightsLockedIn = houseLightsLockedCount ?? null;
  const houseLightsTotalPlayers = totalPlayers ?? null;
  const progress = denominator > 0 ? Math.min(1, lockedIn / denominator) : 0;

  return (
    <TVStage data-testid="tv-question">
      <TVHouseLights
        roomMagicEnabled={roomMagicEnabled}
        lockedCount={houseLightsLockedIn}
        totalPlayers={houseLightsTotalPlayers}
        accent={cc}
      />
      <TVHeader
        accent={cc}
        left="GAME · LIVE"
        right="EVERY PHONE: SCRAMBLED · YOUR # IS YOURS"
      />

      {/* Category banner */}
      <div
        style={{
          margin: "24px 56px 0",
          padding: "16px 24px",
          borderRadius: 14,
          background: cc,
          color: "#0E0805",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Eyebrow color="rgba(14,8,5,.65)" size={11}>CATEGORY</Eyebrow>
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" }}>
            {category}
          </span>
        </div>
        <PointTag value={value} color="#0E0805" ink={cc} size="md" />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "28px 56px 0",
          display: "grid",
          gridTemplateColumns: showImage ? "260px 1fr 180px" : "1fr 180px",
          // Lock the one grid row to the container's height. Without this,
          // the image's intrinsic 260px (with alignSelf: flex-start) bullies
          // the row taller than the container in short viewports — the frame
          // then reports a clientHeight larger than what's visible, and the
          // auto-fit hook picks a font size that overflows into the answer
          // cards below. minmax(0, 1fr) forces the row to exactly the flex
          // share, clipping any oversized children via overflow: hidden.
          gridTemplateRows: "minmax(0, 1fr)",
          gap: 32,
          alignItems: "stretch",
          position: "relative",
          zIndex: 1,
          overflow: "hidden",
        }}
      >
        {showImage ? (
          <div
            style={{
              width: 260,
              height: 260,
              // Cap height to the grid row so the image doesn't get cropped
              // when the viewport is tight. The image still tries for its
              // design 260px but shrinks to whatever the row actually has.
              maxHeight: "100%",
              borderRadius: 16,
              overflow: "hidden",
              background: t.surface,
              border: `1px solid ${t.line}`,
              flexShrink: 0,
              alignSelf: "flex-start",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageUrl}
              alt=""
              data-testid="tv-question-image"
              onError={() => setImageFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        ) : null}
        <div
          ref={frameRef as RefObject<HTMLDivElement>}
          data-testid="tv-question-prompt"
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "flex-start",
          }}
        >
          <div
            ref={textRef as RefObject<HTMLDivElement>}
            style={{
              // Match Display's "Bricolage Grotesque hero" voice so the prompt
              // keeps the editorial feel — useAutoFitText drives the size.
              fontFamily: "var(--font-display)",
              fontOpticalSizing: "auto",
              fontStretch: "85%",
              fontWeight: 500,
              fontSize: `${questionFontSize}px`,
              letterSpacing: "-0.025em",
              lineHeight: 0.92,
              color: t.ink,
            }}
          >
            {question}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, alignSelf: "flex-start" }}>
          <TVTimerArc accent={cc} seconds={seconds} />
          <Eyebrow color={seconds <= 5 ? t.wrong : cc} size={10}>
            {seconds <= 5 ? "FINAL SECONDS" : "SPEED BONUS < 5s"}
          </Eyebrow>
        </div>
      </div>

      <div
        style={{
          padding: "36px 56px 0",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 18,
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        {opts.map((o) => (
          <div
            key={o.n}
            style={{
              background: t.dark ? "rgba(244,230,196,.06)" : "#FFF",
              border: `1.5px solid ${t.line}`,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "20px 24px",
              minHeight: 110,
            }}
          >
            <Numeric size={84} weight={700} color={cc} tracking={-0.05} style={{ lineHeight: 1 }}>
              {o.n}
            </Numeric>
            <span
              data-testid="tv-question-option-text"
              style={{
                fontSize: "clamp(32px, 4vmin, 44px)",
                color: t.ink,
                fontWeight: 650,
                lineHeight: 1.08,
                letterSpacing: "-0.012em",
              }}
            >
              {o.text}
            </span>
          </div>
        ))}
      </div>

      {/* One stationary status for every theme. Player names and scores do not
          move while the room is trying to read the question from a distance. */}
      <div
        data-testid="tv-question-pile"
        style={{
          padding: "18px 56px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 32,
          marginTop: "auto",
          position: "relative",
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            data-testid="tv-question-lock-status"
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "clamp(24px, 1.8vw, 30px)",
                fontWeight: 750,
                letterSpacing: "0.025em",
                color: t.ink,
              }}
            >
              {lockedIn} OF {denominator} LOCKED IN
            </span>
            <Eyebrow color={t.inkMute} size={11}>READ HERE · TAP ON YOUR PHONE</Eyebrow>
          </div>
          <div
            style={{
              width: "100%",
              height: 10,
              background: t.line,
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: "100%",
                background: cc,
                borderRadius: 99,
                transition: "width .25s ease",
              }}
            />
          </div>
        </div>
        {lockInAnnouncement ? (
          <span
            aria-live="polite"
            style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
          >
            {lockInAnnouncement}
          </span>
        ) : null}
      </div>
    </TVStage>
  );
}

// TV — question reveal. Bold category banner across the top, big editorial
// question text, four chunky cards underneath showing the scrambled order.
// The TV always shows numbers — each phone gets its own private order
// (scramble enforced server-side).
//
// When `tiles` is supplied, the lower section renders the live LockInPileUp
// pile (each landed answer becomes a tile). When omitted, the older static
// "21 of 32 locked in" progress strip is used (so the gallery still reads).

"use client";

import type { RefObject } from "react";
import { TVStage, TVHeader } from "@/components/shells";
import {
  Eyebrow,
  Numeric,
  PointTag,
  ThemeProvider,
  TVTimerArc,
  useTheme,
} from "@/components/system";
import type { LockInTile } from "@/components/tv/lockin/roster";
import { TVHouseLights } from "@/components/tv/TVHouseLights";
import {
  TVScoreboardMarquee,
  type MarqueeChip,
} from "@/components/tv/TVScoreboardMarquee";
import { useAutoFitText } from "@/lib/hooks/useAutoFitText";
import { categoryColor } from "@/lib/theme/categories";
import { hasMarquee } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";

// Candidate font sizes for the question prompt — picked so that the longest
// real-world prompts (the AI generator caps around 200 chars) still fit inside
// the question region while short prompts get the full editorial hero size.
// The image variant has less horizontal room because the 260px thumbnail
// claims its column, so its ceiling is a notch lower.
const QUESTION_SIZES_NO_IMAGE = [44, 52, 60, 68, 76, 86] as const;
const QUESTION_SIZES_WITH_IMAGE = [36, 44, 52, 60, 68, 72] as const;

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
  /** Live lock-in tiles. When provided, the pile-up renders below the answers. */
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
  // --- May/Storm marquee props ---
  /** When supplied alongside a marquee-enabled theme, replaces the lock-in
   *  pile with the auto-scrolling scoreboard strip. */
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
  themeKey,
  marqueeChips,
  spotlightedPlayerId,
  lockInAnnouncement,
  roomMagicEnabled = false,
  houseLightsLockedCount,
}: TVQuestionProps) {
  const { t } = useTheme();
  const cc = categoryColor(category, t.accent);
  // Shrink the prompt only as much as needed to keep the answer cards on
  // screen — the host's HDMI'd laptop drives the venue TV, so the actual
  // pixel viewport varies night to night. Measurement (not media queries) is
  // what guarantees fit.
  const { frameRef, textRef, fontSize: questionFontSize } = useAutoFitText({
    sizes: imageUrl ? QUESTION_SIZES_WITH_IMAGE : QUESTION_SIZES_NO_IMAGE,
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

  // Map the live tiles (which carry stable IDs) onto LockInTile shape that
  // LockInPileUp expects. Tiles already arrive newest-last so the pile
  // "lands" the most recent answers with the entrance animation.
  const pileTiles: LockInTile[] | undefined = tiles?.map((tile) => ({
    name: tile.name,
    t: tile.t,
    isYou: tile.isYou,
  }));

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
          gridTemplateColumns: imageUrl ? "260px 1fr 180px" : "1fr 180px",
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
        {imageUrl ? (
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
            <img
              src={imageUrl}
              alt=""
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
            <span style={{ fontSize: 22, color: t.inkMid, fontWeight: 500, letterSpacing: "-0.005em" }}>
              {o.text}
            </span>
          </div>
        ))}
      </div>

      {/* May/Storm: swap in the scrolling scoreboard strip when theme + chips are both present.
          All other themes (and May without chips) fall through to the existing lock-in pile. */}
      {themeKey && hasMarquee(themeKey) && marqueeChips ? (
        <div
          style={{
            padding: "20px 56px 16px",
            marginTop: "auto",
            position: "relative",
            zIndex: 1,
            flexShrink: 0,
          }}
        >
          <TVScoreboardMarquee
            chips={marqueeChips}
            spotlightedPlayerId={spotlightedPlayerId ?? null}
            announcement={lockInAnnouncement}
          />
        </div>
      ) : pileTiles && pileTiles.length > 0 ? (
        // Live pile-up of locked-in answer tiles. We render only the pile body
        // here (not the LockInBase scaffold) so it lives inside the existing
        // TVQuestion stage and shares its question/timer/answers.
        <div
          data-testid="tv-question-pile"
          style={{
            padding: "20px 56px 16px",
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: "auto",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <Eyebrow color={t.inkMid} size={11}>
              {lockedIn} OF {denominator} LOCKED IN
            </Eyebrow>
            <Eyebrow color={t.inkMute} size={10}>READ HERE · TAP ON YOUR PHONE</Eyebrow>
          </div>
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              background: t.dark ? "rgba(244,230,196,.03)" : "rgba(27,19,12,.03)",
              borderRadius: 14,
              padding: 16,
              maxHeight: 220,
            }}
          >
            <PileTiles tiles={pileTiles} accent={cc} ink={t.ink} />
          </div>
        </div>
      ) : (
        <div
          data-testid="tv-question-pile"
          style={{
            padding: "16px 56px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "auto",
            position: "relative",
            zIndex: 1,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: cc,
                animation: "tr1via-pulse 1s ease-in-out infinite",
              }}
            />
            <Eyebrow color={t.inkMid} size={11}>{lockedIn} OF {denominator} LOCKED IN</Eyebrow>
            <div style={{ width: 200, height: 4, background: t.line, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: cc }} />
            </div>
          </div>
          <Eyebrow color={t.inkMute} size={10}>READ HERE · TAP ON YOUR PHONE</Eyebrow>
        </div>
      )}
    </TVStage>
  );
}

/**
 * Trimmed-down pile renderer matching LockInPileUp's tile choreography.
 *
 * We don't reuse LockInPileUp directly here because that component owns the
 * LockInBase scaffold (header + answers + timer); on the live TVQuestion we
 * only want the pile body, not a second copy of the question card. The
 * styling intentionally mirrors LockInPileUp tile-by-tile.
 */
function PileTiles({
  tiles,
  accent,
  ink,
}: {
  tiles: LockInTile[];
  accent: string;
  ink: string;
}) {
  const seedRot = (i: number) => ((i * 2654435761) % 7) - 3;
  const seedX = (i: number) => ((i * 16807) % 9) - 4;
  const landThreshold = Math.max(0, tiles.length - 3);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-end" }}>
      {tiles.map((p, i) => {
        const rot = seedRot(i);
        const x = seedX(i);
        const finalTransform = `translate3d(${x}px, 0, 0) rotate(${rot}deg)`;
        const animate = i >= landThreshold;
        return (
          <div
            key={`${p.name}-${i}`}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              background: accent,
              color: "#0E0805",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.005em",
              display: "flex",
              alignItems: "center",
              gap: 7,
              transform: finalTransform,
              boxShadow: `0 4px 10px -3px ${accent}66`,
              ...({ "--tile-final": finalTransform } as React.CSSProperties),
              animation: animate
                ? `tr1via-tile-land .45s cubic-bezier(.2,.7,.3,1) ${(i - landThreshold) * 80}ms both`
                : "none",
              outline: p.isYou ? `2px solid ${ink}` : "none",
              outlineOffset: p.isYou ? 2 : 0,
            }}
          >
            {p.name}
            {p.t && (
              <Numeric size={10} weight={600} color="rgba(14,8,5,.6)">
                {p.t}
              </Numeric>
            )}
          </div>
        );
      })}
    </div>
  );
}

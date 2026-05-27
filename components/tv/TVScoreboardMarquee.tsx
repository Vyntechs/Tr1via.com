// Auto-scrolling scoreboard marquee — the bottom strip of the TV during
// live questions on the May/Storm theme. Replaces today's lock-in pile.
//
// Sort: score descending, join-order tiebreak (stable). Re-sort on score
// updates (which only occur at reveal — mid-question scores are static).
//
// Auto-scroll: when 6+ chips, the track slides left on a pure CSS keyframe
// so the TV GPU handles the composite. The chip list is duplicated (second
// set aria-hidden) so the loop has no visible seam. Skipped entirely when
// the OS prefers reduced motion.

"use client";

import { useMemo } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export interface MarqueeChip {
  playerId: string;
  name: string;
  color: string;
  score: number;
  joinIndex: number;
  /** When set true, the chip shows a +SPD badge during its strike (spotlight). */
  speedBonus?: boolean;
}

export interface TVScoreboardMarqueeProps {
  chips: MarqueeChip[];
  spotlightedPlayerId?: string | null;
  /** Latest lock-in event text for screen reader announcement. */
  announcement?: string;
}

const MAX_NAME_CHARS = 12;

// Scroll kicks in at 6+ chips — fewer fit without overflowing most TV widths.
const SCROLL_THRESHOLD = 6;
// At 1.2s per chip the track takes ≥20s for a full pass (feels leisurely on TV).
const SCROLL_SECONDS_PER_CHIP = 1.2;
const MIN_SCROLL_SECONDS = 20;

export function TVScoreboardMarquee({
  chips,
  spotlightedPlayerId,
  announcement,
}: TVScoreboardMarqueeProps) {
  const sorted = useMemo(() => sortChips(chips), [chips]);
  const reducedMotion = usePrefersReducedMotion();
  const shouldScroll = sorted.length >= SCROLL_THRESHOLD && !reducedMotion;
  const scrollSeconds = Math.max(MIN_SCROLL_SECONDS, sorted.length * SCROLL_SECONDS_PER_CHIP);

  const trackStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    paddingLeft: 24,
    paddingRight: 24,
    willChange: "transform",
    ...(shouldScroll && {
      animation: `tv-marquee-scroll ${scrollSeconds}s linear infinite`,
    }),
  };

  return (
    <div
      data-testid="tv-scoreboard-marquee"
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "12px 0",
        background: "rgba(244,230,196,.03)",
        borderRadius: 8,
      }}
    >
      {/* Visually hidden — only spoken by screen readers when announcement changes. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
        }}
      >
        {announcement ?? ""}
      </div>

      <div data-testid="marquee-track" style={trackStyle}>
        {sorted.map((chip) => (
          <Chip
            key={chip.playerId}
            chip={chip}
            spotlight={spotlightedPlayerId === chip.playerId}
          />
        ))}
        {/* Duplicate set for seamless loop — aria-hidden so readers skip the repeat. */}
        {shouldScroll && (
          <div aria-hidden="true" style={{ display: "contents" }}>
            {sorted.map((chip) => (
              <Chip
                key={`dup-${chip.playerId}`}
                chip={chip}
                spotlight={false}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes tv-marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function Chip({ chip, spotlight }: { chip: MarqueeChip; spotlight: boolean }) {
  // Trim after slicing so a name like "CHRISTOPHER COLUMBUS" doesn't produce
  // "CHRISTOPHER …" (trailing space before the ellipsis).
  const displayName =
    chip.name.length > MAX_NAME_CHARS
      ? `${chip.name.slice(0, MAX_NAME_CHARS).trimEnd()}…`
      : chip.name;

  return (
    <div
      data-testid="marquee-chip"
      data-player-id={chip.playerId}
      data-spotlight={spotlight ? "true" : undefined}
      style={{
        background: spotlight ? chip.color : "rgba(244,230,196,.08)",
        color: spotlight ? "#0E0805" : "#F4E6C4",
        padding: "8px 12px",
        borderRadius: 7,
        fontFamily: "system-ui, sans-serif",
        fontSize: 16,
        fontWeight: 700,
        whiteSpace: "nowrap",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        letterSpacing: "-0.005em",
        transition: "background .2s ease, transform .25s ease",
        transform: spotlight ? "scale(1.05)" : "scale(1)",
      }}
    >
      <span
        data-testid="marquee-chip-dot"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: chip.color,
          flexShrink: 0,
        }}
      />
      {/* Isolated span so getByText(name regex) returns just the name node. */}
      <span data-testid="marquee-chip-name">{displayName}</span>
      <span
        style={{
          color: spotlight ? "rgba(14,8,5,.6)" : "#B8A98C",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {chip.score.toLocaleString()}
      </span>
      {/* Badge only fires when both speedBonus is set AND this chip is spotlighted. */}
      {chip.speedBonus && spotlight && (
        <span
          data-testid="marquee-chip-spd"
          style={{
            background: "#FFD93D",
            color: "#0E0805",
            padding: "2px 5px",
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.06em",
          }}
        >
          +SPD
        </span>
      )}
    </div>
  );
}

function sortChips(chips: MarqueeChip[]): MarqueeChip[] {
  return [...chips].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.joinIndex - b.joinIndex;
  });
}

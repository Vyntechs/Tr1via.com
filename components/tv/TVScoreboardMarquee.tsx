// Auto-scrolling scoreboard marquee — the bottom strip of the TV during
// live questions on the May/Storm theme. Replaces today's lock-in pile.
//
// Sort: score descending, join-order tiebreak (stable). Re-sort on score
// updates (which only occur at reveal — mid-question scores are static).
//
// Auto-scroll comes in Task 10. This file ships the shell: sort, chip
// rendering, aria-live region, +SPD badge during spotlight strikes.

"use client";

import { useMemo } from "react";

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

export function TVScoreboardMarquee({
  chips,
  spotlightedPlayerId,
  announcement,
}: TVScoreboardMarqueeProps) {
  const sorted = useMemo(() => sortChips(chips), [chips]);

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

      <div
        data-testid="marquee-track"
        style={{
          display: "flex",
          gap: 8,
          paddingLeft: 24,
          paddingRight: 24,
          willChange: "transform",
        }}
      >
        {sorted.map((chip) => (
          <Chip
            key={chip.playerId}
            chip={chip}
            spotlight={spotlightedPlayerId === chip.playerId}
          />
        ))}
      </div>
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

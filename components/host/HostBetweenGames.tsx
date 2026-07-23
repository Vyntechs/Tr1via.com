"use client";

import { Display, Eyebrow, Numeric, useTheme } from "@/components/system";
import { readableForeground } from "@/lib/theme/contrast";

export type HostBetweenGamesMode =
  | "intermission"
  | "present-winners"
  | "finale"
  | "complete";

export interface HostBetweenGamesStanding {
  playerId: string;
  name: string;
  score: number;
  rank?: number;
}

export interface HostBetweenGamesProps {
  mode: HostBetweenGamesMode;
  standings?: HostBetweenGamesStanding[];
  onPrimary?: () => void;
  busy?: boolean;
}

const CONTENT: Record<
  HostBetweenGamesMode,
  { eyebrow: string; heading: string; body: string; action: string | null }
> = {
  intermission: {
    eyebrow: "Game 1 complete",
    heading: "Game 2 is ready",
    body: "Players can see their Game 1 result. Start Game 2 when the venue is ready.",
    action: "Start Game 2",
  },
  "present-winners": {
    eyebrow: "FINAL GAME COMPLETE",
    heading: "Final scores are ready",
    body: "Present winners to end the final game and move the venue TV and player phones to their finale.",
    action: "Present winners",
  },
  finale: {
    eyebrow: "FINALE",
    heading: "Winners are being presented",
    body: "Let the celebration breathe. End the game when you are ready to close it.",
    action: "End game",
  },
  complete: {
    eyebrow: "FINISHED",
    heading: "Game complete",
    body: "The game is closed. Final scores remain available in Scores.",
    action: null,
  },
};

export function HostBetweenGames({
  mode,
  standings = [],
  onPrimary,
  busy = false,
}: HostBetweenGamesProps) {
  const { t } = useTheme();
  const content = CONTENT[mode];
  const rows = standings.slice(0, 5);

  return (
    <section
      data-testid="host-between-games"
      data-mode={mode}
      style={{
        minHeight: "100%",
        padding: "18px clamp(14px, 4vw, 26px) max(20px, env(safe-area-inset-bottom))",
        color: t.ink,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <Eyebrow color={t.accent} size={10}>{content.eyebrow}</Eyebrow>
      <h1 style={{ margin: "10px 0 0" }}>
        <Display
          size={44}
          color={t.ink}
          weight={700}
          tracking={-0.035}
          style={{ display: "block", lineHeight: 0.96 }}
        >
          {content.heading}
        </Display>
      </h1>
      <p style={{ margin: "14px 0 0", color: t.inkMid, fontSize: 15, lineHeight: 1.5, maxWidth: 560 }}>
        {content.body}
      </p>

      {rows.length > 0 && (
        <section
          aria-labelledby="host-between-standings"
          style={{ marginTop: 24, padding: 16, borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}
        >
          <h2
            id="host-between-standings"
            style={{ margin: 0, color: t.inkMid, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            {mode === "intermission" ? "Game 1 standings" : "Final standings"}
          </h2>
          <ol style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {rows.map((row, index) => (
              <li
                key={row.playerId}
                style={{
                  minHeight: 48,
                  padding: "8px 10px",
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 12,
                  background: index === 0 ? t.surfaceH : "transparent",
                  boxSizing: "border-box",
                }}
              >
                <Numeric size={18} weight={800} color={index === 0 ? t.accent : t.inkMid}>{row.rank ?? index + 1}</Numeric>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 750 }}>
                  {row.name}
                </span>
                <Numeric size={17} weight={800} color={t.ink}>{row.score.toLocaleString()}</Numeric>
              </li>
            ))}
          </ol>
        </section>
      )}

      {content.action && (
        <button
          type="button"
          onClick={onPrimary}
          disabled={!onPrimary || busy}
          style={{
            width: "100%",
            minHeight: 48,
            marginTop: "auto",
            padding: "12px 18px",
            border: "none",
            borderRadius: 14,
            background: t.accent,
            color: readableForeground(t.accent),
            font: "inherit",
            fontSize: 16,
            fontWeight: 850,
            cursor: !onPrimary || busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
            boxSizing: "border-box",
          }}
        >
          {busy ? `${content.action.replace(/s$/, "")}…` : content.action}
        </button>
      )}
    </section>
  );
}

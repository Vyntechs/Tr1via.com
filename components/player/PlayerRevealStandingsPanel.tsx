"use client";

import { useTheme, Eyebrow, Numeric } from "@/components/system";
import type { StandingRow } from "@/lib/player/betweenGames";

export interface PlayerRevealStandingsPanelProps {
  rows: StandingRow[];
  meRank: number | null;
  total: number;
  surface?: "theme" | "payoff";
}

export function PlayerRevealStandingsPanel({
  rows,
  meRank,
  total,
  surface = "theme",
}: PlayerRevealStandingsPanelProps) {
  const { t } = useTheme();
  const visibleRows = compactRowsAroundPlayer(rows);
  const isPayoffSurface = surface === "payoff";
  const panelBackground = isPayoffSurface ? "rgba(14,8,5,.10)" : t.surfaceH;
  const panelBorder = isPayoffSurface ? "rgba(14,8,5,.14)" : t.line;
  const primaryInk = isPayoffSurface ? "#0E0805" : t.ink;
  const secondaryInk = isPayoffSurface ? "rgba(14,8,5,.62)" : t.inkMid;
  const regularRowBackground = isPayoffSurface
    ? "rgba(255,255,255,.28)"
    : t.surface;
  const youRowBackground = isPayoffSurface ? "#0E0805" : t.ink;
  const youRowInk = isPayoffSurface ? t.correct : t.paper;

  return (
    <div
      data-testid="reveal-standings-panel"
      style={{
        marginTop: 14,
        padding: "12px",
        borderRadius: 14,
        background: panelBackground,
        border: `1px solid ${panelBorder}`,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Eyebrow color={secondaryInk} size={9}>
          Where you stand
        </Eyebrow>
        <span style={{ flex: 1 }} />
        {meRank ? (
          <span style={{ color: primaryInk, fontSize: 12, fontWeight: 800 }}>
            #{meRank} of {total}
          </span>
        ) : (
          <span style={{ color: secondaryInk, fontSize: 12, fontWeight: 700 }}>
            in the mix
          </span>
        )}
      </div>

      {visibleRows.length > 0 && (
        <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
          {visibleRows.map((row) => (
            <div
              key={`${row.rank}-${row.name}`}
              data-testid={row.isYou ? "reveal-standings-you" : "reveal-standings-row"}
              style={{
                display: "grid",
                gridTemplateColumns: "34px 1fr auto",
                alignItems: "center",
                gap: 8,
                minHeight: 30,
                padding: "6px 8px",
                borderRadius: 9,
                background: row.isYou ? youRowBackground : regularRowBackground,
                color: row.isYou ? youRowInk : primaryInk,
                fontWeight: row.isYou ? 800 : 700,
              }}
            >
              <Numeric size={13} weight={800} color="currentColor">
                #{row.rank}
              </Numeric>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                }}
              >
                {row.name}
              </span>
              <Numeric size={13} weight={800} color="currentColor">
                {row.score.toLocaleString()}
              </Numeric>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function compactRowsAroundPlayer(rows: StandingRow[]): StandingRow[] {
  const maxRows = 4;
  if (rows.length <= maxRows) return rows;

  const playerIndex = rows.findIndex((row) => row.isYou);
  if (playerIndex < 0) return rows.slice(0, maxRows);

  const start = Math.min(
    Math.max(playerIndex - 1, 0),
    Math.max(rows.length - maxRows, 0),
  );
  return rows.slice(start, start + maxRows);
}

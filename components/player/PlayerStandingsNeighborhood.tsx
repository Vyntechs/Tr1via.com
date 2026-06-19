"use client";

import { useTheme, Display, Eyebrow, Numeric } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { StandingRow } from "@/lib/player/betweenGames";

export interface PlayerStandingsNeighborhoodProps {
  rows: StandingRow[];
  meRank: number | null;
  total: number;
}

export function PlayerStandingsNeighborhood({
  rows,
  meRank,
  total,
}: PlayerStandingsNeighborhoodProps) {
  const { t } = useTheme();
  return (
    <PhoneScreen data-testid="standings-neighborhood">
      <PhoneHeader eyebrow="WHERE YOU STAND" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 12 }}>
        <div data-testid="standings-headline">
          <Display size={40} color={t.ink}>
            {meRank ? <>You&apos;re <span style={{ color: t.accent }}>#{meRank}</span></> : "Nice run."}
          </Display>
        </div>
        {meRank && (
          <div style={{ marginTop: 4, fontSize: 14, color: t.inkMid }}>of {total} tonight</div>
        )}

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 7 }}>
          {rows.map((row) => (
            <div
              key={`${row.rank}-${row.name}`}
              data-testid={row.isYou ? "standings-you" : "standings-row"}
              style={{
                display: "grid",
                gridTemplateColumns: "40px 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 12,
                background: row.isYou ? t.accent : t.surface,
                color: row.isYou ? "#0E0805" : t.ink,
                fontWeight: row.isYou ? 700 : 500,
              }}
            >
              <Numeric size={16} weight={700} color="currentColor">#{row.rank}</Numeric>
              <span style={{ fontSize: 16, fontWeight: row.isYou ? 700 : 600 }}>{row.name}</span>
              <Numeric size={16} weight={700} color="currentColor">{row.score.toLocaleString()}</Numeric>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            padding: "16px 18px",
            borderRadius: 12,
            background: t.surface,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: t.pop, animation: "tr1via-pulse 1.8s ease-in-out infinite" }} />
          <Eyebrow color={t.inkMute} size={11}>NEXT QUESTION COMING UP…</Eyebrow>
        </div>
      </div>
    </PhoneScreen>
  );
}

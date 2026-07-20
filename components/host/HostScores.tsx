"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ThemeProvider, useTheme } from "@/components/system";
import type { GameScoreRow } from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";
import { AdjustPointsModal } from "./AdjustPointsModal";
import type { HostLivePlayer } from "./HostLiveConsole";

export interface HostScoresProps {
  themeKey?: ThemeKey;
  gameNo: number | null;
  scores: GameScoreRow[];
  onSubmitAdjustment: (playerId: string, delta: number, reason: string) => void;
}

export function HostScores({ themeKey, ...props }: HostScoresProps) {
  if (themeKey) return <ThemeProvider themeKey={themeKey}><HostScoresInner {...props} /></ThemeProvider>;
  return <HostScoresInner {...props} />;
}

function HostScoresInner({ gameNo, scores, onSubmitAdjustment }: Omit<HostScoresProps, "themeKey">) {
  const { t } = useTheme();
  const [query, setQuery] = useState("");
  const [adjusting, setAdjusting] = useState<HostLivePlayer | null>(null);
  const ranked = useMemo(
    () => [...scores]
      .filter((row): row is GameScoreRow & { player_id: string } => Boolean(row.player_id))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.display_name ?? "Player").localeCompare(b.display_name ?? "Player")),
    [scores],
  );
  const players = useMemo<HostLivePlayer[]>(() => ranked.map((row) => ({
    id: row.player_id,
    name: row.display_name ?? "Player",
    score: row.score ?? 0,
    locked: false,
    appOff: "",
  })), [ranked]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = ranked.filter((row) => !needle || (row.display_name ?? "Player").toLocaleLowerCase().includes(needle));
  const panel: CSSProperties = { border: `1px solid ${t.line}`, borderRadius: 16, background: t.surface };

  return (
    <section aria-label="Scores" style={{ minHeight: "100%", padding: 14, color: t.ink, background: t.paper, boxSizing: "border-box" }}>
      <p style={{ margin: 0, color: t.accent, fontSize: 10, fontWeight: 900, letterSpacing: ".14em" }}>SCORES</p>
      <h1 style={{ margin: "5px 0 14px", fontFamily: "var(--font-display)", fontSize: "clamp(25px, 7vw, 38px)", lineHeight: 1.04 }}>{gameNo ? `Game ${gameNo} standings` : "Game standings"}</h1>
      <input
        type="search"
        aria-label="Search players"
        placeholder={`Search ${ranked.length} players`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ ...panel, width: "100%", minHeight: 48, padding: "0 14px", boxSizing: "border-box", color: t.ink, font: "inherit", fontSize: 14, outlineColor: t.pop }}
      />

      {visible.length === 0 ? (
        <p style={{ color: t.inkMid, fontSize: 13 }}>{ranked.length === 0 ? "Scores appear after play begins." : "No players match that search."}</p>
      ) : (
        <ol style={{ margin: "14px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 9 }}>
          {visible.map((row) => {
            const rank = ranked.indexOf(row) + 1;
            const player = players.find((candidate) => candidate.id === row.player_id)!;
            return (
              <li key={row.player_id}>
                <button
                  type="button"
                  aria-label={`Adjust points for ${player.name}`}
                  onClick={() => setAdjusting(player)}
                  style={{ ...panel, width: "100%", minWidth: 48, minHeight: 48, padding: "9px 12px", color: t.ink, font: "inherit", cursor: "pointer", display: "grid", gridTemplateColumns: "26px minmax(0, 1fr) auto", alignItems: "center", gap: 10, textAlign: "left", boxSizing: "border-box" }}
                >
                  <strong style={{ color: rank === 1 ? t.correct : t.inkMid, fontFamily: "var(--font-mono)", fontSize: 13 }}>{rank}</strong>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{player.name}</strong>
                    <span style={{ display: "block", marginTop: 3, color: t.inkMid, fontSize: 10 }}>
                      {row.correct_count ?? 0} correct · {row.answered_count ?? 0} answered
                    </span>
                  </span>
                  <strong style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>{(row.score ?? 0).toLocaleString()}</strong>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {adjusting && (
        <AdjustPointsModal
          initialPlayer={adjusting}
          allPlayers={players}
          onCancel={() => setAdjusting(null)}
          onSubmit={(playerId, delta, reason) => {
            onSubmitAdjustment(playerId, delta, reason);
            setAdjusting(null);
          }}
        />
      )}
    </section>
  );
}

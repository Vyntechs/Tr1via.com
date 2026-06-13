// Player phone — BETWEEN GAMES (joined, waiting for Game 2). Replaces the old
// fall-through to Game 1's last reveal. Reassures first ("You're in Game 2"),
// then holds attention with the Game 1 standings + tap-to-cheer, with a gentle
// pulse so it reads as alive, not frozen.

"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme, Display, Eyebrow, Numeric } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { StandingRow } from "@/lib/player/betweenGames";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const CHEERS = ["🔥", "👏", "🎉"] as const;

export interface PlayerBetweenGamesProps {
  playerName?: string;
  /** Top rows of the Game-1 leaderboard (ranked). */
  top?: StandingRow[];
  /** The player's own row, pinned below the list when they rank past the cutoff. */
  you?: StandingRow | null;
  /** Upcoming Game-2 ready topics — the same "Tonight's Topics" the venue TV and
   *  lobby show. Renders a preview panel so a waiting player sees what Game 2 is
   *  about. Empty/omitted → no panel (matches the lobby's empty-state). */
  topics?: LobbyTopic[];
}

export function PlayerBetweenGames({
  playerName = "You",
  top = [],
  you = null,
  topics = [],
}: PlayerBetweenGamesProps = {}) {
  const { t } = useTheme();
  const [floats, setFloats] = useState<{ id: number; emoji: string }[]>([]);
  const nextId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Cancel any pending float-cleanup timers on unmount (e.g. host starts Game 2
  // within 1.2s of a cheer tap) so they can't fire against an unmounted tree.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function cheer(emoji: string) {
    const id = nextId.current++;
    setFloats((f) => [...f, { id, emoji }]);
    // Remove after the rise animation. setTimeout (not onAnimationEnd) so the
    // cleanup is deterministic and works in jsdom too.
    timers.current.push(
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1200),
    );
  }

  function Row({ row, pinned }: { row: StandingRow; pinned?: boolean }) {
    return (
      <div
        data-testid={row.isYou ? "standings-you" : "standings-row"}
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr auto",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 12,
          background: row.isYou ? t.accent : t.surface,
          color: row.isYou ? "#0E0805" : t.ink,
          border: pinned ? `1.5px dashed ${t.accent}` : "none",
          fontWeight: row.isYou ? 700 : 500,
        }}
      >
        <Numeric size={18} weight={700} color="currentColor">{row.rank}</Numeric>
        <span style={{ fontSize: 16, fontWeight: row.isYou ? 700 : 600 }}>{row.name}</span>
        <Numeric size={18} weight={700} color="currentColor">{row.score.toLocaleString()}</Numeric>
      </div>
    );
  }

  return (
    <PhoneScreen data-testid="player-between-games">
      <PhoneHeader eyebrow="HALFTIME · GAME 2 NEXT" />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 14, position: "relative" }}>
        <Display size={44} color={t.ink}>
          You&apos;re <span style={{ color: t.pop }}>in Game 2.</span>
        </Display>
        <div style={{ marginTop: 6, fontSize: 14, color: t.inkMid }}>
          Game 1 standings — fresh board starts when the host says go.
        </div>

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow color={t.inkMute} size={10}>AFTER GAME 1</Eyebrow>
          {top.map((row) => <Row key={`${row.rank}-${row.name}`} row={row} />)}
          {you && <Row row={you} pinned />}
        </div>

        {topics.length > 0 && (
          <div
            data-testid="player-between-games-topics"
            // flexShrink + scrollable inner list so a small phone with many
            // topics scrolls this panel instead of clipping the cheer strip.
            style={{ marginTop: 22, minHeight: 0, flexShrink: 1, overflowY: "auto" }}
          >
            <Eyebrow color={t.inkMute} size={10}>GAME 2 TOPICS</Eyebrow>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {topics.map((topic, i) => {
                const bar = topic.color ?? categoryColor(topic.name);
                return (
                  <div
                    key={`${topic.position}-${topic.topic}`}
                    data-testid="player-between-games-topic"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      // Staggered fade-in only (global tr1via-rise keyframe) — no
                      // infinite loop, so the phone stays calm and battery-easy.
                      animation: `tr1via-rise .5s cubic-bezier(.2,.7,.3,1) ${i * 0.06}s both`,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{ flex: "none", width: 6, height: 22, borderRadius: 99, background: bar }}
                    />
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 16,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        color: t.ink,
                      }}
                    >
                      {topic.topic}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: "auto", paddingTop: 18 }}>
          <Eyebrow color={t.inkMute} size={10}>SEND A CHEER</Eyebrow>
          <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
            {CHEERS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                data-testid="cheer-btn"
                onClick={() => cheer(emoji)}
                style={{
                  flex: 1,
                  fontSize: 28,
                  padding: "14px 0",
                  borderRadius: 14,
                  border: `1.5px solid ${t.line}`,
                  background: t.surface,
                  cursor: "pointer",
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: 16,
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.06em",
              color: t.inkMute,
              animation: "bg-pulse 1.8s ease-in-out infinite",
            }}
          >
            WAITING FOR HOST · {playerName.toUpperCase()}
          </div>
        </div>

        {/* Local cheer floats — rise + fade on the player's own screen. */}
        {floats.map((f) => (
          <span
            key={f.id}
            data-testid="cheer-float"
            style={{
              position: "absolute",
              bottom: 90,
              left: "50%",
              fontSize: 32,
              pointerEvents: "none",
              animation: "cheer-rise 1.2s ease-out forwards",
            }}
          >
            {f.emoji}
          </span>
        ))}

        <style>{`
          @keyframes cheer-rise {
            0% { transform: translate(-50%, 0) scale(0.8); opacity: 0; }
            20% { opacity: 1; }
            100% { transform: translate(-50%, -160px) scale(1.2); opacity: 0; }
          }
          @keyframes bg-pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    </PhoneScreen>
  );
}

// Player phone — JOIN GAME 2.
// Between games. Hero moment for re-entry. Big "Wrapped." headline with the
// player's final placement + score card (best category, fastest answer), then
// a one-tap CTA. Name is already in — frictionless re-entry.

"use client";

import {
  useTheme,
  Display,
  Eyebrow,
  Numeric,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

export interface PlayerJoinGame2Props {
  themeKey?: ThemeKey;
  /** Player's display name — printed in the CTA caption. */
  playerName?: string;
  /** Final 1-based placement in game 1. `null` when not yet known
   *  (game_scores still loading, or no participation row for game 1) —
   *  renders "Wrapped. Nice run." instead of the meaningless "#0". */
  finalRank?: number | null;
  /** Final cumulative score from game 1. */
  finalScore?: number;
  /** Best-performing category name (drives the color). */
  bestCategory?: string;
  /** "7/7" style accuracy string for the best category. */
  bestCategoryRatio?: string;
  /** Fastest answer time in seconds (e.g. 1.4). */
  fastestSeconds?: number;
  /** Tap handler — fires when the player opts into game 2. */
  onJoin?: () => void;
  /** True while a join request is in flight. Disables the CTA. */
  submitting?: boolean;
  /** Upcoming Game-2 ready topics — the same "Tonight's Topics" the venue TV and
   *  lobby show. Renders a preview panel so a player deciding whether to rejoin
   *  sees what Game 2 is about. Empty/omitted → no panel. */
  topics?: LobbyTopic[];
}

export function PlayerJoinGame2({
  themeKey: _themeKey,
  playerName = "Maya",
  finalRank = 5,
  finalScore = 4820,
  bestCategory = "Music",
  bestCategoryRatio = "7/7",
  fastestSeconds = 1.4,
  onJoin,
  submitting,
  topics = [],
}: PlayerJoinGame2Props = {}) {
  const { t } = useTheme();
  const ctaDisabled = !onJoin || submitting;
  return (
    <PhoneScreen data-testid="player-join-game2">
      <PhoneHeader eyebrow="GAME 1 · FINAL" />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 18 }}>
        <Display size={56} color={t.ink}>
          Wrapped.
          <br />
          {finalRank && finalRank > 0 ? (
            <>You finished <span style={{ color: t.pop }}>#{finalRank}</span>.</>
          ) : (
            <span style={{ color: t.pop }}>Nice run.</span>
          )}
        </Display>

        <div style={{ marginTop: 20, padding: "20px 22px", borderRadius: 14, background: t.surface }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Eyebrow color={t.inkMid} size={10}>YOUR SCORE</Eyebrow>
            <Numeric size={36} weight={700} color={t.ink}>{finalScore.toLocaleString()}</Numeric>
          </div>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <Eyebrow color={t.inkMid} size={9}>BEST CATEGORY</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 14,
                  fontWeight: 600,
                  color: categoryColor(bestCategory),
                  letterSpacing: "-0.005em",
                }}
              >
                {bestCategory} · {bestCategoryRatio}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <Eyebrow color={t.inkMid} size={9}>FASTEST</Eyebrow>
              <div style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: t.ink }}>{fastestSeconds.toFixed(1)}s</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 26, fontSize: 14, color: t.inkMid, lineHeight: 1.5 }}>
          Game 2 starts fresh — everyone back to zero. Same room, new board.{" "}
          <span style={{ color: t.ink, fontWeight: 600 }}>Your name is already in.</span>
        </div>

        {topics.length > 0 && (
          <div
            data-testid="player-join-game2-topics"
            // flexShrink + scrollable inner list so a small phone with many
            // topics scrolls this panel instead of pushing the Join CTA away.
            style={{ marginTop: 24, minHeight: 0, flexShrink: 1, overflowY: "auto" }}
          >
            <Eyebrow color={t.inkMid} size={10}>GAME 2 TOPICS</Eyebrow>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {topics.map((topic, i) => {
                const bar = topic.color ?? categoryColor(topic.name);
                return (
                  <div
                    key={`${topic.position}-${topic.label}`}
                    data-testid="player-join-game2-topic"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      // Staggered fade-in only (global tr1via-rise keyframe).
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
                      {topic.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={ctaDisabled ? undefined : onJoin}
        disabled={ctaDisabled}
        data-testid="player-join-game2-submit"
        style={{
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "22px 0",
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: ctaDisabled ? "default" : "pointer",
          opacity: ctaDisabled && !onJoin ? 1 : submitting ? 0.55 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          boxShadow: `0 14px 32px -10px ${t.accent}66`,
        }}
      >
        {submitting ? "Joining…" : "Join Game 2  →"}
      </button>
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: t.inkMute,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        ONE TAP · {playerName.toUpperCase()}
      </div>
    </PhoneScreen>
  );
}

// TV lobby — "Tonight's Topics" panel. Shows the upcoming game's category
// topics (the specific theme strings, e.g. "Disney Pixar Movies") so players
// deciding whether to join can see what the game is about. Every topic is
// visible at once — no cycling, no waiting. Rows cascade in, then gently float
// while their color bar shimmers. Pure-CSS motion (no JS loop) so it costs
// nothing on the host laptop; reduced-motion is honored globally by
// app/globals.css. Renders nothing when there are no ready topics.

"use client";

import { Eyebrow, useTheme } from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

/** Demo data for the /dev/tv gallery (not used in production). */
export const DEMO_LOBBY_TOPICS: LobbyTopic[] = [
  { name: "Movies",    topic: "Disney Pixar Movies",  color: "#E64A8C", position: 0 },
  { name: "Music",     topic: "80s One-Hit Wonders",  color: "#9B7BD8", position: 1 },
  { name: "Geography", topic: "World Capitals",       color: "#4ECDC4", position: 2 },
  { name: "Sports",    topic: "Famous Quarterbacks",  color: "#5AA8E0", position: 3 },
  { name: "Science",   topic: "Kitchen Science",      color: "#7AC4A8", position: 4 },
];

export function TVLobbyTopics({ topics }: { topics: LobbyTopic[] }) {
  const { t } = useTheme();
  if (topics.length === 0) return null;

  return (
    <div data-testid="tv-lobby-topics" style={{ marginTop: "clamp(16px, 3vh, 40px)", maxWidth: 580 }}>
      <Eyebrow color={t.inkMute} size={11}>TONIGHT&apos;S TOPICS</Eyebrow>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: "clamp(6px, 1.2vh, 12px)",
        }}
      >
        {topics.map((topic, i) => {
          const bar = topic.color ?? categoryColor(topic.name);
          return (
            <div
              key={`${topic.position}-${topic.topic}`}
              data-testid="tv-lobby-topic"
              // Cascade entrance — staggered so rows arrive one after another.
              style={{ animation: `tr1via-rise .5s cubic-bezier(.2,.7,.3,1) ${i * 0.07}s both` }}
            >
              <div
                // Idle float on an inner wrapper so it never fights the
                // entrance transform on the row. Desynced per row so the
                // board breathes organically instead of bobbing in unison.
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  animation: `tr1via-float 4s ease-in-out ${i * 0.4}s infinite`,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    width: 8,
                    height: "clamp(22px, 3.4vh, 34px)",
                    borderRadius: 99,
                    background: `linear-gradient(90deg, ${bar} 0%, ${bar} 35%, rgba(255,255,255,0.6) 50%, ${bar} 65%, ${bar} 100%)`,
                    backgroundSize: "200% 100%",
                    animation: `tr1via-shimmer 3s linear ${i * 0.5}s infinite`,
                  }}
                />
                <span
                  style={{
                    // minWidth:0 lets a long topic ellipsize instead of
                    // bullying the row wider than its column (the flex analog
                    // of the minmax(0,1fr) grid-row trap).
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "clamp(18px, 2.6vh, 30px)",
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    lineHeight: 1.15,
                    color: t.ink,
                  }}
                >
                  {topic.topic}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

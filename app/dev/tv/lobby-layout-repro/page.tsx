// Repro for the lobby "Tonight's Topics" clipping Brandon hit on the host
// console (screenshot 2026-06-07): the last topics are cut off behind the
// control strip. The /dev/tv gallery's fixed 1280x720 Frame hides it because
// it doesn't reproduce HostLiveConsole's flex panel + control-strip height
// theft. This wraps TVLobby in the *exact* same parent structure so we can
// reproduce and inspect the clipping at a real laptop viewport.

"use client";

import { TVLobby, DEMO_ROSTER } from "@/components/tv";
import { LaptopShell } from "@/components/shells";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

// Mirrors a founder-built game: 6 ready categories with the long natural-
// language topic strings the AI generates (like the screenshot).
const REPRO_TOPICS: LobbyTopic[] = [
  { name: "Games",     topic: "classic and modern video games",   color: "#E64A8C", position: 0 },
  { name: "Sports",    topic: "legendary athletes across major sports", color: "#5AA8E0", position: 1 },
  { name: "Mythology", topic: "Greek, Roman, and Norse mythology", color: "#9B7BD8", position: 2 },
  { name: "Science",   topic: "space exploration milestones",     color: "#7AC4A8", position: 3 },
  { name: "Music",     topic: "one-hit wonders of the 1980s",     color: "#4ECDC4", position: 4 },
  { name: "Film",      topic: "blockbuster movie quotes",         color: "#F0A35E", position: 5 },
];

export default function LobbyLayoutReproPage() {
  return (
    <LaptopShell>
      <div
        data-testid="host-live-console"
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          background: "#000",
          position: "relative",
        }}
      >
        <div
          data-testid="host-tv-panel"
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <TVLobby
            themeKey="june"
            venueName="BUILD TEST"
            scheduledDate="BRANDON NICHOLS"
            roomCode="XVB·X7Q"
            inRoomCount={0}
            roster={DEMO_ROSTER.slice(0, 0)}
            joinUrl="https://tr1via.com/join?code=XVBX7Q"
            hostStatusLine="ROOM OPEN · STARTS WHEN HOST IS READY"
            gameStatusLine="GAME 1 OF 2 · WAITING"
            topics={REPRO_TOPICS}
          />
        </div>
        {/* Stand-in for HostControlStrip — matches its minHeight 52 + padding. */}
        <div
          style={{
            flexShrink: 0,
            minHeight: 52,
            background: "rgba(14,8,5,.92)",
            color: "#F4E6C4",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
          }}
        >
          <span>Start Game 1</span>
          <span>0 players</span>
          <span>Players (0)</span>
        </div>
      </div>
    </LaptopShell>
  );
}

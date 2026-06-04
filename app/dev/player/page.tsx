// Internal player-phone gallery. Browse every player screen at phone size
// (380×780, the iPhone 14 logical viewport approximation we use for static
// previews) with a theme picker so we can verify every theme variant.
//
// Visit at /dev/player in dev. Pick a theme; each screen renders inside its
// own ThemeProvider so the picker drives all nine at once.

"use client";

import { useState } from "react";
import {
  ThemeProvider,
  useTheme,
  Wordmark,
  Eyebrow,
} from "@/components/system";
import {
  PlayerJoin,
  PlayerLobby,
  PlayerQuestion,
  PlayerLocked,
  PlayerRevealCorrect,
  PlayerRevealWrong,
  PlayerJoinGame2,
  PlayerBetweenGames,
  PlayerWinnerCard,
  PlayerRecap,
} from "@/components/player";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";

interface ScreenEntry {
  key: string;
  title: string;
  Component: React.ComponentType;
}

// Sample Pexels URL — Alaska/landscape photo, lets the gallery preview the
// PlayerQuestion "with image" variant. Same domain (`images.pexels.com`) the
// real generation pipeline uses, so this matches production behavior.
const SAMPLE_QUESTION_IMAGE =
  "https://images.pexels.com/photos/1366630/pexels-photo-1366630.jpeg?auto=compress&cs=tinysrgb&w=200";

function PlayerQuestionWithImage() {
  return (
    <PlayerQuestion
      prompt="Which U.S. state has the largest land area?"
      imageUrl={SAMPLE_QUESTION_IMAGE}
    />
  );
}

// Long-prompt variant — exercises the auto-fit text path. 163 chars matches
// the longest prompt currently in the prod DB (Chippewa Falls boot company)
// so we can preview the worst-case font-size on every theme + every phone
// width. If the prompt ever pushes the answer cards off-screen here, the
// real player phone is also broken.
function PlayerQuestionLong() {
  return (
    <PlayerQuestion
      prompt="Which work boot company, still operating in Chippewa Falls, Wisconsin, is known for making custom boots to order for specific trades like firefighting and logging?"
    />
  );
}

// ⚠️ Fixed-size preview only — validate the REAL /room/[code] route (dev frames
// hide the flex/grid behavior that fires in production layouts).
function PlayerBetweenGamesSample() {
  return (
    <PlayerBetweenGames
      playerName="You"
      top={[
        { rank: 1, name: "Alice", score: 12320, isYou: false },
        { rank: 2, name: "You", score: 9160, isYou: true },
        { rank: 3, name: "Carol", score: 8420, isYou: false },
        { rank: 4, name: "Bob", score: 3080, isYou: false },
        { rank: 5, name: "Dave", score: 2100, isYou: false },
      ]}
      you={null}
    />
  );
}

// ⚠️ Fixed-size preview only — validate the REAL /room/[code] route. Shows the
// live standings now surfaced on the locked screen after a player answers.
function PlayerLockedSample() {
  return (
    <PlayerLocked
      standings={{
        top: [
          { rank: 1, name: "Alice", score: 12320, isYou: false },
          { rank: 2, name: "You", score: 9160, isYou: true },
          { rank: 3, name: "Carol", score: 8420, isYou: false },
          { rank: 4, name: "Bob", score: 3080, isYou: false },
          { rank: 5, name: "Dave", score: 2100, isYou: false },
        ],
        you: null,
      }}
    />
  );
}

const SCREENS: ScreenEntry[] = [
  { key: "join",                title: "01 · Join",                       Component: PlayerJoin },
  { key: "lobby",               title: "02 · Lobby",                      Component: PlayerLobby },
  { key: "question-text-only",  title: "03 · Question · live (text)",     Component: PlayerQuestion },
  { key: "question-with-image", title: "03b · Question · live (w/ image)", Component: PlayerQuestionWithImage },
  { key: "question-long",       title: "03c · Question · live (long, 163ch)", Component: PlayerQuestionLong },
  { key: "locked",              title: "04 · Locked · live standings",    Component: PlayerLockedSample },
  { key: "reveal-correct",      title: "05 · Reveal · correct",           Component: PlayerRevealCorrect },
  { key: "reveal-wrong",        title: "06 · Reveal · wrong",             Component: PlayerRevealWrong },
  { key: "join-game-2",         title: "07 · Join Game 2",                Component: PlayerJoinGame2 },
  { key: "between-games",       title: "07b · Between Games · waiting",   Component: PlayerBetweenGamesSample },
  { key: "winner-card",         title: "08 · Winner card · finale",       Component: PlayerWinnerCard },
  { key: "recap",               title: "09 · Recap · finale",             Component: PlayerRecap },
];

export default function PlayerGallery() {
  const [themeKey, setThemeKey] = useState<ThemeKey>("house");

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 48px",
        background: "#0E0805",
        color: "#F4E6C4",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <GalleryHeader themeKey={themeKey} setThemeKey={setThemeKey} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: 28,
          }}
        >
          {SCREENS.map(({ key, title, Component }) => (
            <PhoneFrame key={key} title={title} themeKey={themeKey}>
              <Component />
            </PhoneFrame>
          ))}
        </div>
      </div>
    </main>
  );
}

function GalleryHeader({
  themeKey,
  setThemeKey,
}: {
  themeKey: ThemeKey;
  setThemeKey: (k: ThemeKey) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 32,
        paddingBottom: 18,
        borderBottom: "1px solid rgba(244,230,196,.14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* Render the wordmark inside its own ThemeProvider so it picks up the
            current gallery theme accent. */}
        <ThemeProvider themeKey={themeKey}>
          <Wordmark size={28} />
        </ThemeProvider>
        <span style={{ width: 1, height: 16, background: "rgba(244,230,196,.2)" }} />
        <Eyebrow color="rgba(244,230,196,.6)" size={11}>PLAYER PHONE · 9 SCREENS</Eyebrow>
      </div>
      <select
        value={themeKey}
        onChange={(e) => setThemeKey(e.target.value as ThemeKey)}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid rgba(244,230,196,.2)",
          background: "rgba(244,230,196,.05)",
          color: "#F4E6C4",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {THEME_KEYS.map((k) => (
          <option key={k} value={k} style={{ background: "#0E0805", color: "#F4E6C4" }}>
            {TR1VIA_THEMES[k].name}
          </option>
        ))}
      </select>
    </div>
  );
}

// iPhone-ish frame — 380×780 viewport with a subtle device chrome so each
// screen reads as a phone, not a card. Notch + rounded bezel are decorative;
// the inner area is the live render surface.
function PhoneFrame({
  title,
  themeKey,
  children,
}: {
  title: string;
  themeKey: ThemeKey;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow color="rgba(244,230,196,.6)" size={10}>{title}</Eyebrow>
      <div
        style={{
          width: 380,
          height: 780,
          borderRadius: 44,
          background: "#0E0805",
          padding: 10,
          boxSizing: "border-box",
          border: "1px solid rgba(244,230,196,.16)",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4) inset",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            width: 110,
            height: 26,
            borderRadius: 14,
            background: "#000",
            zIndex: 5,
          }}
          aria-hidden="true"
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 36,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <ThemeProvider themeKey={themeKey}>{children}</ThemeProvider>
        </div>
      </div>
    </div>
  );
}

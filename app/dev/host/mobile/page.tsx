"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  HostGenEdit,
  HostGenImageSwap,
  HostGenImageUpload,
  HostGenLoading,
  HostGenManualEntry,
  HostGenOverview,
  HostGenPick,
  HostGenTopicEntry,
} from "@/components/host/gen";
import {
  HostCommandCenter,
  HostDashboard,
  HostVenueMonitor,
  type HostSection,
} from "@/components/host";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const SURFACES = [
  "overview",
  "topic",
  "loading",
  "pick",
  "edit",
  "image-swap",
  "image-upload",
  "manual",
  "dashboard",
  "command-center",
] as const;
type Surface = (typeof SURFACES)[number];

export default function HostMobilePreviewPage() {
  return (
    <Suspense fallback={null}>
      <HostMobilePreview />
    </Suspense>
  );
}

function HostMobilePreview() {
  const requested = useSearchParams().get("surface");
  const surface = SURFACES.includes(requested as Surface)
    ? (requested as Surface)
    : "overview";

  return (
    <main style={{ minHeight: "100dvh", width: "100%", overflowX: "hidden" }}>
      {surface === "overview" && <HostGenOverview />}
      {surface === "topic" && <HostGenTopicEntry />}
      {surface === "loading" && <HostGenLoading />}
      {surface === "pick" && (
        <HostGenPick
          onTogglePick={() => {}}
          onReorder={() => {}}
          onEdit={() => {}}
          onRename={async () => {}}
        />
      )}
      {surface === "edit" && <HostGenEdit />}
      {surface === "image-swap" && <HostGenImageSwap />}
      {surface === "image-upload" && <HostGenImageUpload state="idle" />}
      {surface === "manual" && <HostGenManualEntry />}
      {surface === "dashboard" && (
        <HostDashboard
          tonight={{
            nightId: "mobile-proof-night",
            venue: "Soul Fire Pizza",
            date: "Wed Jul 22",
            isToday: true,
            roomCode: "K9PR4M",
            themeKey: "house",
            status: "live",
          }}
        />
      )}
      {surface === "command-center" && <CommandCenterPreview />}
    </main>
  );
}

const COMMAND_CENTER_SNAPSHOT: TVSnapshot = {
  night: {
    id: "mobile-proof-night",
    venueName: "Soul Fire Pizza",
    themeKey: "house",
    hostDefaultThemeKey: "house",
    roomCode: "K9PR4M",
    openedAt: "2026-07-20T00:00:00.000Z",
    closedAt: null,
    scheduledAt: "2026-07-20T00:00:00.000Z",
    isLocked: false,
    roomMagicEnabled: false,
  },
  games: [
    {
      id: "game-1",
      gameNo: 1,
      state: "ready",
      startedAt: null,
      endedAt: null,
      categoryCount: 1,
      questionCount: 1,
    },
  ],
  currentGameId: "game-1",
  categories: [
    {
      id: "category-1",
      gameId: "game-1",
      name: "Music",
      topic: "Music",
      position: 0,
      color: "#E64A8C",
      state: "ready",
    },
  ],
  questions: [
    {
      id: "question-1",
      categoryId: "category-1",
      pointValue: 100,
      prompt: "Which singer released Purple Rain?",
      options: ["Prince", "Bowie", "Madonna", "Cher"],
      correctIndex: 0,
      imageUrl: null,
      factBlurb: "Prince released Purple Rain in 1984.",
      playedAt: null,
      finishedAt: null,
      isPicked: true,
    },
  ],
  liveQuestionId: null,
  targetQuestionId: null,
  players: [],
  scores: [],
  liveAnswers: [],
  reveals: [],
};

function CommandCenterPreview() {
  const [active, setActive] = useState<HostSection>("board");

  return (
    <HostCommandCenter
      stage="game-ready"
      active={active}
      playerCount={31}
      lockedCount={0}
      delivery={{ tv: "current", currentPhones: 31, recoveringPhones: 0 }}
      onNavigate={setActive}
      venueMonitor={
        <HostVenueMonitor
          snapshot={COMMAND_CENTER_SNAPSHOT}
          themeKey="house"
        />
      }
    >
      <div style={{ display: "grid", gap: 14, padding: 4 }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: ".12em" }}>GAME READY</p>
        <h1 style={{ margin: 0, fontSize: 28 }}>Original · Game 1</h1>
        <button
          type="button"
          style={{ minHeight: 52, border: 0, borderRadius: 12, fontWeight: 800 }}
        >
          Start Game 1
        </button>
      </div>
    </HostCommandCenter>
  );
}

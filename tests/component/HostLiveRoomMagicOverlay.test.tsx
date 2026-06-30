import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HostLiveConsole } from "@/components/host/HostLiveConsole";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { RoomMagicReactionEvent } from "@/lib/room-magic/reactions";

const TV_SNAPSHOT: TVSnapshot = {
  night: {
    id: "night-1",
    venueName: "Heather's",
    themeKey: "june",
    hostDefaultThemeKey: null,
    roomCode: "K9PR4M",
    openedAt: new Date().toISOString(),
    closedAt: null,
    scheduledAt: null,
    isLocked: false,
    roomMagicEnabled: true,
  },
  games: [],
  currentGameId: null,
  categories: [],
  questions: [],
  liveQuestionId: null,
  targetQuestionId: null,
  players: [],
  scores: [],
  liveAnswers: [],
  reveals: [],
};

function roomMagicEvent(): RoomMagicReactionEvent {
  return {
    kind: "wow",
    questionId: "question-1",
    playerId: "player-1",
    serverNow: new Date().toISOString(),
  };
}

describe("HostLiveConsole Room Magic overlay", () => {
  it("renders the Room Magic overlay inside the embedded TV panel", () => {
    render(
      <HostLiveConsole
        themeKey="june"
        tvSnapshot={TV_SNAPSHOT}
        roomMagicEnabled
        lastRoomMagicReaction={roomMagicEvent()}
      />,
    );

    const panel = screen.getByTestId("host-tv-panel");
    expect(
      within(panel).getByTestId("tv-room-magic-overlay"),
    ).toBeInTheDocument();
  });

  it("does not render the host mirror overlay when Room Magic is disabled", () => {
    render(
      <HostLiveConsole
        themeKey="june"
        tvSnapshot={TV_SNAPSHOT}
        roomMagicEnabled={false}
        lastRoomMagicReaction={roomMagicEvent()}
      />,
    );

    expect(
      within(screen.getByTestId("host-tv-panel")).queryByTestId(
        "tv-room-magic-overlay",
      ),
    ).not.toBeInTheDocument();
  });
});

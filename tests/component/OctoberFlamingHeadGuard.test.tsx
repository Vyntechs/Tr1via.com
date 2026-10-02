// October · the flaming head on the winner's phone (the room's finale and the
// winner card) sits inside the theme crash guard. If the art ever throws, the
// line switches off and the screen is exactly what a night without the
// flaming head shows; the result, score and stats all stay.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

// "real": the flaming head draws. "throw": the art crashes. "none": a night
// with no flaming head at all (the reference picture).
const mode = vi.hoisted(() => ({ value: "real" as "real" | "throw" | "none" }));
const h = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));

vi.mock("@/components/experience/october/tv/OctoberScreens", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/experience/october/tv/OctoberScreens")>();
  return {
    ...real,
    FlamingHead: (props: Parameters<typeof real.FlamingHead>[0]) => {
      if (mode.value === "throw") throw new Error("flaming head exploded");
      return real.FlamingHead(props);
    },
  };
});

vi.mock("@/lib/experience/packs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/experience/packs")>();
  return {
    ...real,
    hasPhoneLayer: (themeKey: Parameters<typeof real.hasPhoneLayer>[0]) =>
      mode.value === "none" ? false : real.hasPhoneLayer(themeKey),
  };
});

// The room page, as in the other player-room tests: no network, no realtime.
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "ABCDEF" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => {
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn((callback?: (status: string) => void) => {
        callback?.("SUBSCRIBED");
        return channel;
      }),
    };
    return {
      realtime: { connect: vi.fn(), disconnect: vi.fn() },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
  },
}));
vi.mock("@/lib/room/fetchRoomSnapshot", () => ({ fetchRoomSnapshotPayload: h.fetchSnapshot }));
vi.mock("@/lib/hooks/useRevalidateOnFocus", () => ({ useRevalidateOnFocus: () => 0 }));
vi.mock("@/lib/hooks/useFreshnessWatchdog", () => ({ useFreshnessWatchdog: () => undefined }));
vi.mock("@/lib/hooks/useUnreachableRetry", () => ({ useUnreachableRetry: () => undefined }));
vi.mock("@/lib/hooks/useRoomRoutePoll", () => ({ useRoomRoutePoll: () => undefined }));
vi.mock("@/lib/hooks/useDeviceSession", () => ({
  useDeviceSession: () => ({ isReady: true, isLoading: false }),
}));
vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));

import PlayerRoomPage from "@/app/(player)/room/[code]/page";
import { PlayerWinnerCard } from "@/components/player";
import { ThemeProvider } from "@/components/system";
import { __resetReachabilityForTests } from "@/lib/realtime/reachability";

// A one-game October night that has ended; Maya won it.
function finalePayload(): RoomSnapshotPayload {
  const maya = {
    playerKey: "player-key-1",
    displayName: "Maya",
    joinedAt: "2026-10-07T23:01:00.000Z",
    lastSeenAt: "2026-10-07T23:50:00.000Z",
    removedAt: null,
    appSwitchTotalSeconds: 0,
  };
  const ben = { ...maya, playerKey: "player-key-2", displayName: "Ben" };
  const score = (who: typeof maya, points: number, correct: number) => ({
    gameId: "game-1",
    playerKey: who.playerKey,
    displayName: who.displayName,
    score: points,
    answeredCount: 7,
    correctCount: correct,
    fastestCorrectMs: 2100,
  });
  return {
    audience: "player",
    night: {
      nightKey: "night-key-1",
      venue_name: "Soul Fire Pizza",
      room_code: "ABCDEF",
      scheduled_at: null,
      opened_at: "2026-10-07T23:00:00.000Z",
      closed_at: null,
      theme_key: "october",
      is_locked: false,
      room_magic_enabled: false,
      created_at: "2026-10-07T22:00:00.000Z",
    },
    hostDefaultThemeKey: "house",
    games: [{
      id: "game-1",
      game_no: 1,
      state: "done",
      started_at: "2026-10-07T23:05:00.000Z",
      ended_at: "2026-10-07T23:45:00.000Z",
      category_count: 1,
      question_count: 7,
    }],
    categories: [],
    players: [maya, ben],
    currentQuestion: null,
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    self: maya,
    myAnswers: [],
    myParticipations: [{ gameId: "game-1", joinedAt: "2026-10-07T23:01:00.000Z" }],
    scores: [score(maya, 2400, 6), score(ben, 1500, 4)],
    allScores: [score(maya, 2400, 6), score(ben, 1500, 4)],
    questionScrambles: {},
  } as RoomSnapshotPayload;
}

async function finaleHtml(): Promise<string> {
  h.fetchSnapshot.mockResolvedValue(finalePayload());
  const { unmount } = render(<PlayerRoomPage />);
  const finale = await screen.findByTestId("player-finale");
  await waitFor(() => expect(finale).toHaveTextContent("You won."));
  const html = finale.innerHTML;
  unmount();
  return html;
}

function winnerCardHtml(): string {
  const wrap = (node: ReactNode) => <ThemeProvider themeKey="october">{node}</ThemeProvider>;
  const { container, unmount } = render(
    wrap(<PlayerWinnerCard venueName="Soul Fire Pizza" nightDateLabel="Oct 7" finalScore={2400} blurb="" />),
  );
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("October flaming head on the winner's phone", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // React reports the caught crash on the console; the guard warns once.
    vi.spyOn(console, "error").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.clear();
    __resetReachabilityForTests();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterEach(() => {
    mode.value = "real";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("finale: a crashing flaming head leaves the screen exactly as a night without one", async () => {
    mode.value = "real";
    const withHead = await finaleHtml();
    expect(withHead).toContain("You hold the flaming head.");

    mode.value = "none";
    const reference = await finaleHtml();
    expect(reference).not.toContain("flaming head");

    mode.value = "throw";
    const crashed = await finaleHtml();
    expect(crashed).toBe(reference);
    expect(crashed).toContain("You won.");
    expect(crashed).toContain("2,400");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"october:finale-flaming-head" switched off'),
      expect.anything(),
      expect.anything(),
    );
  });

  it("winner card: a crashing flaming head leaves the card exactly as a night without one", () => {
    mode.value = "real";
    expect(winnerCardHtml()).toContain("You hold the flaming head.");

    mode.value = "none";
    const reference = winnerCardHtml();
    expect(reference).not.toContain("flaming head");

    mode.value = "throw";
    const crashed = winnerCardHtml();
    expect(crashed).toBe(reference);
    expect(crashed).toContain("You won.");
    expect(crashed).toContain("2,400");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"october:winner-card-flaming-head" switched off'),
      expect.anything(),
      expect.anything(),
    );
  });
});

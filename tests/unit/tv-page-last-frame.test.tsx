// The TV page and the real useTVRoom together: a failed poll leaves the last
// frame on screen. Only the channel and the heavy TV children are stand-ins.

import { Suspense, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const channel = vi.hoisted(() => {
  const c = { on: () => c, subscribe: () => c };
  return c;
});
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({ channel: () => channel, removeChannel: () => {} }),
}));
vi.mock("@/components/tv", () => ({
  ScaledTVCanvas: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TVStateMachine: ({ snapshot }: { snapshot: TVSnapshot }) => (
    <div data-testid="tv-frame">{snapshot.night.venueName}</div>
  ),
  TVSectionComplete: () => null,
  TVRoomMagicOverlay: () => null,
}));
vi.mock("@/lib/audio/welcomeChime", () => ({ playWelcomeChime: () => {} }));
vi.mock("@/components/system/Lightning", () => ({ fireLightningBeat: () => {} }));
vi.mock("@/lib/hooks/useSectionCompleteCelebration", () => ({
  useSectionCompleteCelebration: () => null,
}));

import TVPage from "@/app/tv/[code]/page";

function snapshot(venueName: string): TVSnapshot {
  return {
    night: {
      id: "night-key",
      venueName,
      themeKey: "june",
      hostDefaultThemeKey: null,
      roomCode: "EP8G5U",
      openedAt: null,
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
      roomMagicEnabled: false,
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
}

const good = (venueName: string) =>
  ({ ok: true, status: 200, json: async () => snapshot(venueName) }) as unknown as Response;
const refused = (status: number) => ({ ok: false, status }) as Response;

/** Answers each snapshot request from the list; other URLs just succeed. */
function stubSnapshotReplies(replies: Array<() => Promise<Response>>) {
  const queue = [...replies];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      String(url).endsWith("/snapshot")
        ? (queue.shift() ?? (() => Promise.resolve(refused(503))))()
        : Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response),
    ),
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderPage() {
  const params = Promise.resolve({ code: "EP8G5U" });
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <TVPage params={params} />
      </Suspense>,
    );
  });
  await advance(0);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TV page through a failed poll", () => {
  it("keeps the last frame through failed polls and picks up the next good one", async () => {
    vi.useFakeTimers();
    stubSnapshotReplies([
      () => Promise.resolve(good("Last good")),
      () => Promise.resolve(refused(503)),
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(good("Back online")),
    ]);
    await renderPage();
    expect(screen.getByTestId("tv-frame")).toHaveTextContent("Last good");

    await advance(4_000);
    expect(screen.getByTestId("tv-frame")).toHaveTextContent("Last good");
    expect(screen.queryByText("Something's off.")).not.toBeInTheDocument();

    await advance(4_000);
    expect(screen.getByTestId("tv-frame")).toHaveTextContent("Last good");
    expect(screen.queryByText("Something's off.")).not.toBeInTheDocument();

    await advance(4_000);
    expect(screen.getByTestId("tv-frame")).toHaveTextContent("Back online");
  });

  it("still shows the message when there has never been a frame", async () => {
    vi.useFakeTimers();
    stubSnapshotReplies([() => Promise.resolve(refused(503))]);
    await renderPage();

    expect(screen.queryByTestId("tv-frame")).not.toBeInTheDocument();
    expect(screen.getByText("Something's off.")).toBeInTheDocument();
  });

  it("drops the frame when the room is really gone", async () => {
    vi.useFakeTimers();
    stubSnapshotReplies([
      () => Promise.resolve(good("Last good")),
      () => Promise.resolve(refused(404)),
    ]);
    await renderPage();
    expect(screen.getByTestId("tv-frame")).toBeInTheDocument();

    await advance(4_000);
    expect(screen.queryByTestId("tv-frame")).not.toBeInTheDocument();
    expect(screen.getByText("Game not found")).toBeInTheDocument();
  });
});

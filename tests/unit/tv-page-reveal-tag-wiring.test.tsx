// The /tv page hands the state machine the question a reveal message was for, so
// the machine can refuse a message from another question.

import { Suspense } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const h = vi.hoisted(() => ({
  lastBroadcast: null as unknown,
  seen: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/hooks/useTVRoom", () => ({
  useTVRoom: () => ({
    snapshot: {
      night: { id: "n", venueName: "V", themeKey: "house", hostDefaultThemeKey: null, roomCode: "EP8G5U" },
      players: [],
    } as unknown as TVSnapshot,
    status: "ready",
    lastBroadcast: h.lastBroadcast,
  }),
}));
vi.mock("@/components/tv", () => ({
  ScaledTVCanvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TVStateMachine: (props: Record<string, unknown>) => {
    h.seen = props;
    return null;
  },
  TVSectionComplete: () => null,
  TVRoomMagicOverlay: () => null,
}));
vi.mock("@/lib/audio/welcomeChime", () => ({ playWelcomeChime: () => {} }));
vi.mock("@/components/system/Lightning", () => ({ fireLightningBeat: () => {} }));
vi.mock("@/lib/hooks/useSectionCompleteCelebration", () => ({
  useSectionCompleteCelebration: () => null,
}));

import TVPage from "@/app/tv/[code]/page";

async function renderPage() {
  const params = Promise.resolve({ code: "EP8G5U" });
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <TVPage params={params} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  h.seen = null;
});

describe("/tv page: reveal message question id", () => {
  it("passes the question id of a reveal message", async () => {
    h.lastBroadcast = { event: "reveal", questionId: "q2", serverNow: "2026-07-20T02:00:00.000Z" };
    await renderPage();
    expect(h.seen?.lastBroadcastQuestionId).toBe("q2");
  });

  it("passes none for any other kind of message", async () => {
    h.lastBroadcast = { event: "resolve", questionId: "q2", serverNow: "2026-07-20T02:00:00.000Z" };
    await renderPage();
    expect(h.seen?.lastBroadcastQuestionId).toBeNull();
  });
});

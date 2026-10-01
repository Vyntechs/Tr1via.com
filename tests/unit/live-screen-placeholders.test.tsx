import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerLocked } from "@/components/player/PlayerLocked";
import { PlayerJoin } from "@/components/player/PlayerJoin";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import { HostLiveConsole } from "@/components/host/HostLiveConsole";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { computeQuestionNumber } from "@/lib/player/questionNumber";

// Screens built from a design mock kept the mock's numbers and names as
// defaults, and the live callers never overrode them. Every Wednesday the room
// saw "21/32" on each locked-in phone, "Soul Fire Pizza Pizza, hosted by
// Linda" on the join screen, and Game 2 counted against the whole room.

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

function wrap(node: ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("player locked-in screen", () => {
  it("never shows the mock 21/32 when the room count isn't live", () => {
    // Exactly the props the live room page passes today (no lockedCount).
    render(wrap(<PlayerLocked category="History" totalPlayers={28} />));
    expect(screen.getByTestId("player-locked")).toBeInTheDocument();
    expect(screen.queryByText("21/32")).not.toBeInTheDocument();
  });

  it("still shows a count when a caller supplies one", () => {
    render(wrap(<PlayerLocked category="History" lockedSummary="9/12" />));
    expect(screen.getByText("9/12")).toBeInTheDocument();
  });
});

describe("phone question number", () => {
  // Real boards number categories 1-6 (Sep 24: Willie Nelson = 1 ... The
  // color Green = 6). The old formula printed "QUESTION 8" for the first pick.
  const categories = [
    { id: "c1", game_id: "g1" },
    { id: "c6", game_id: "g1" },
    { id: "c7", game_id: "g2" },
  ];
  const q = (id: string, category_id: string, played_at: string | null) => ({ id, category_id, played_at });

  it("the first question of the night is QUESTION 1, whatever square was picked", () => {
    const first = q("a", "c6", "2026-10-07T23:10:00Z");
    expect(computeQuestionNumber(first, categories, [first, q("b", "c1", null)])).toBe(1);
  });

  it("counts in the order the host played them, per game", () => {
    const played = [
      q("a", "c6", "2026-10-07T23:10:00Z"),
      q("b", "c1", "2026-10-07T23:12:00Z"),
      q("c", "c1", "2026-10-07T23:14:00Z"),
      q("g2a", "c7", "2026-10-08T00:20:00Z"),
    ];
    expect(computeQuestionNumber(played[2]!, categories, played)).toBe(3);
    // Game 2 starts again at 1.
    expect(computeQuestionNumber(played[3]!, categories, played)).toBe(1);
  });

  it("still counts right when the live question hasn't reached the list yet", () => {
    const earlier = [q("a", "c6", "2026-10-07T23:10:00Z"), q("b", "c1", "2026-10-07T23:12:00Z")];
    expect(computeQuestionNumber(q("c", "c1", "2026-10-07T23:14:00Z"), categories, earlier)).toBe(3);
  });
});

describe("player join screen", () => {
  it("names the real venue once and the real host", () => {
    render(wrap(<PlayerJoin venueName="Soul Fire Pizza" hostName="Heather" onSubmit={() => {}} />));
    expect(screen.getByText(/Wednesday trivia at Soul Fire Pizza, hosted by Heather\./)).toBeInTheDocument();
    expect(screen.queryByText(/Pizza Pizza/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Linda/)).not.toBeInTheDocument();
  });

  it("drops the 'hosted by' clause rather than naming a demo host", () => {
    render(wrap(<PlayerJoin venueName="Soul Fire Pizza" hostName="" onSubmit={() => {}} />));
    expect(screen.getByText(/Wednesday trivia at Soul Fire Pizza\. Pick a name/)).toBeInTheDocument();
    expect(screen.queryByText(/hosted by/)).not.toBeInTheDocument();
  });
});

describe("room lookup for the join screen", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function lookupReturning(displayName: string | null) {
    const result = {
      data: {
        id: "night-1",
        venue_name: "Soul Fire Pizza",
        theme_key: null,
        is_locked: false,
        opened_at: "2026-10-07T23:00:00Z",
        closed_at: null,
        hosts: { default_theme_key: "house", display_name: displayName },
      },
      error: null,
    };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => result),
    };
    adminMock.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => builder) });
    return builder;
  }

  async function lookup() {
    const { GET } = await import("@/app/api/nights/by-code/[code]/route");
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ code: "ABCDEF" }),
    });
    return (await response.json()) as { hostName: string | null; venueName: string };
  }

  it("returns the host's first name", async () => {
    const builder = lookupReturning("Brandon Nichols");
    const body = await lookup();
    expect(body.hostName).toBe("Brandon");
    expect(body.venueName).toBe("Soul Fire Pizza");
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("display_name"));
  });

  it("returns null when the host has no usable name", async () => {
    lookupReturning("   ");
    expect((await lookup()).hostName).toBeNull();
  });
});

function nightSnapshot(overrides: Partial<TVSnapshot> = {}): TVSnapshot {
  const players = ["Alex", "Brooke", "Casey", "Dee", "Eli"].map((name, i) => ({
    id: `pk${i}`,
    displayName: name,
    joinedAt: "2026-10-07T23:00:00Z",
    lastSeenAt: "2026-10-07T23:59:00Z",
  }));
  // Five people in the room; only three opted into Game 2.
  const scores = ["Alex", "Brooke", "Casey"].map((name, i) => ({
    player_key: `pk${i}`,
    display_name: name,
    score: 300 - i * 100,
    correct_count: 1,
    answered_count: 1,
    fastest_correct_ms: 1200 + i * 100,
  }));
  return {
    night: {
      id: "night-key",
      venueName: "Soul Fire Pizza",
      themeKey: "house",
      hostDefaultThemeKey: "house",
      roomCode: "ABC123",
      openedAt: "2026-10-07T23:00:00Z",
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
      roomMagicEnabled: false,
    },
    games: [
      { id: "g1", gameNo: 1, state: "done", startedAt: "2026-10-07T23:05:00Z", endedAt: "2026-10-08T00:05:00Z", categoryCount: 1, questionCount: 1 },
      { id: "g2", gameNo: 2, state: "live", startedAt: "2026-10-08T00:15:00Z", endedAt: null, categoryCount: 1, questionCount: 1 },
    ],
    currentGameId: "g2",
    categories: [
      { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      { id: "c2", gameId: "g2", name: "Music", topic: "Music", position: 0, color: null, state: "ready" },
    ],
    questions: [
      {
        id: "q2",
        categoryId: "c2",
        pointValue: 100,
        prompt: "Which band recorded Abbey Road?",
        options: ["The Beatles", "The Kinks", "The Who", "Queen"],
        correctIndex: 0,
        imageUrl: null,
        factBlurb: null,
        playedAt: "2026-10-08T00:20:00Z",
        finishedAt: "2026-10-08T00:20:30Z",
        isPicked: true,
      },
    ],
    liveQuestionId: null,
    targetQuestionId: "q2",
    players,
    scores,
    liveAnswers: [
      { question_id: "q2", player_key: "pk0", player_name: "Alex", ms_to_lock: 1200, is_correct: true, chosen_index: 0 },
    ],
    reveals: [{ id: "r2", gameId: "g2", questionId: "q2", event: "resolve", occurredAt: "2026-10-08T00:20:30Z", metadata: null }],
    ...overrides,
  };
}

describe("venue TV counts the game, not the room", () => {
  it("a Game 2 reveal says 'of 3', not 'of 5'", () => {
    render(wrap(<TVStateMachine snapshot={nightSnapshot()} />));
    expect(screen.getByText(/of 3 got it/)).toBeInTheDocument();
    expect(screen.queryByText(/of 5 got it/)).not.toBeInTheDocument();
  });

  it("a live Game 2 question counts locks against the Game 2 players", () => {
    const base = nightSnapshot();
    const live = nightSnapshot({
      questions: [{ ...base.questions[0]!, correctIndex: null, finishedAt: null }],
      liveQuestionId: "q2",
      liveAnswers: [
        { question_id: "q2", player_key: "pk0", player_name: "Alex", ms_to_lock: 1200, is_correct: null, chosen_index: null },
      ],
      reveals: [],
    });
    render(wrap(<TVStateMachine snapshot={live} />));
    expect(screen.getByText(/OF 3 LOCKED IN/)).toBeInTheDocument();
  });
});

describe("venue TV winner screen", () => {
  it("labels a normal two-game night as Game 2, with no dangling dot", () => {
    const done = nightSnapshot({
      games: [
        { id: "g1", gameNo: 1, state: "done", startedAt: null, endedAt: null, categoryCount: 1, questionCount: 1 },
        { id: "g2", gameNo: 2, state: "done", startedAt: null, endedAt: null, categoryCount: 1, questionCount: 1 },
      ],
    });
    render(wrap(<TVStateMachine snapshot={done} />));
    expect(screen.getByTestId("tv-finale-winner")).toBeInTheDocument();
    expect(screen.getByText("GAME 2 · FINAL")).toBeInTheDocument();
    expect(screen.getByText("SOUL FIRE PIZZA")).toBeInTheDocument();
    expect(screen.queryByText(/SOUL FIRE PIZZA ·/)).not.toBeInTheDocument();
  });

  it("labels a one-game night as Game 1", () => {
    const oneGame = nightSnapshot({
      games: [
        { id: "g1", gameNo: 1, state: "done", startedAt: null, endedAt: null, categoryCount: 1, questionCount: 1 },
        { id: "g2", gameNo: 2, state: "draft", startedAt: null, endedAt: null, categoryCount: 0, questionCount: 0 },
      ],
      currentGameId: "g1",
      categories: [
        { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      ],
    });
    render(wrap(<TVStateMachine snapshot={oneGame} />));
    expect(screen.getByText("GAME 1 · FINAL")).toBeInTheDocument();
    expect(screen.queryByText("GAME 2 · FINAL")).not.toBeInTheDocument();
  });
});

describe("host laptop while the room loads", () => {
  it("shows a blank frame, never developer text, on the area mirrored to the venue TV", () => {
    render(<HostLiveConsole themeKey="house" tvSnapshot={null} />);
    expect(screen.getByTestId("host-tv-loading")).toBeInTheDocument();
    expect(screen.queryByText(/TV STATE MACHINE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/provide tvSnapshot/)).not.toBeInTheDocument();
  });
});

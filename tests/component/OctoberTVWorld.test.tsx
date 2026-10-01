// October · Sleepy Hollow Night on the venue TV: the world mounts once
// around the TV screens on October nights only, every screen announces its
// moment to it, the redesigned screens appear, and if the world breaks it
// switches off while the game screen carries on.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import { ThemeProvider } from "@/components/system";
import { demoNight, type DemoMoment } from "@/lib/experience/demoNight";
import type { ThemeKey } from "@/lib/theme/tokens";

const crash = { patch: false };
vi.mock("@/components/experience/october/OctoberPatchCanvas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/experience/october/OctoberPatchCanvas")>();
  return {
    ...real,
    OctoberPatchCanvas: (props: Parameters<typeof real.OctoberPatchCanvas>[0]) => {
      if (crash.patch) throw new Error("patch exploded");
      return real.OctoberPatchCanvas(props);
    },
  };
});

// jsdom has no 2D canvas; the patch canvas just stays blank here.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

afterEach(() => {
  crash.patch = false;
  vi.restoreAllMocks();
});

function renderTV(moment: DemoMoment, themeKey: ThemeKey, worldTier?: "full" | "still") {
  const night = demoNight({ moment, nowMs: Date.parse("2026-10-07T23:50:00Z"), secondsLeft: 14, locked: 10 });
  return render(
    <ThemeProvider themeKey={themeKey}>
      <TVStateMachine
        snapshot={{ ...night.snapshot, night: { ...night.snapshot.night, themeKey } }}
        lastBroadcastRevealedAt={night.revealedAt}
        themeKey={themeKey}
        worldTier={worldTier}
      />
    </ThemeProvider>,
  );
}

describe("October world on the venue TV", () => {
  // (Pixel-for-pixel sameness of the other themes is checked by the
  // before/after picture comparison, not here.)
  it("is not mounted on any other theme", () => {
    for (const theme of ["house", "may", "july", "september", "november"] as ThemeKey[]) {
      const { unmount } = renderTV("question", theme);
      expect(screen.queryByTestId("october-world")).toBeNull();
      expect(screen.getByTestId("tv-question")).not.toHaveAttribute("data-stage-world");
      unmount();
    }
  });

  it("mounts once around the screens on an October night", async () => {
    renderTV("question", "october");
    const world = screen.getByTestId("october-world");
    expect(screen.getByTestId("october-patch")).toBeInTheDocument();
    expect(screen.getByTestId("tv-question")).toHaveAttribute("data-stage-world", "october");
    await waitFor(() => expect(world).toHaveAttribute("data-world-moment", "question"));
  });

  it("hears every moment of the night", async () => {
    const expected: Array<[DemoMoment, string]> = [
      ["lobby", "lobby"],
      ["board", "board"],
      ["reveal", "reveal"],
      ["between-games", "between-games"],
      ["winner", "winner"],
    ];
    for (const [moment, kind] of expected) {
      const { unmount } = renderTV(moment, "october");
      await waitFor(() =>
        expect(screen.getByTestId("october-world")).toHaveAttribute("data-world-moment", kind),
      );
      unmount();
    }
  });

  it("shows the October lobby with the 448px QR and the new-pumpkin toast", () => {
    renderTV("lobby", "october");
    const qr = screen.getByTestId("tv-lobby-qr");
    expect(qr.querySelector("div")?.style.width).toBe("448px");
    expect(screen.getByTestId("october-join-toast")).toHaveTextContent("A new pumpkin in the patch");
  });

  it("shows Game 2 rides soon with the 308px QR between games", () => {
    renderTV("between-games", "october");
    expect(screen.getByText("Game 2 rides soon.")).toBeInTheDocument();
    expect(screen.getByTestId("tv-intermission-qr").querySelector("div")?.style.width).toBe("308px");
    expect(screen.getAllByTestId("october-flaming-head")).toHaveLength(1);
  });

  it("gives the winner the flaming head", () => {
    renderTV("winner", "october");
    expect(screen.getByText("WON THE NIGHT · HOLDS THE FLAMING HEAD")).toBeInTheDocument();
    expect(screen.getByTestId("tv-finale-winner-name")).toHaveTextContent("Coach K.");
    expect(screen.getAllByTestId("october-flaming-head").length).toBeGreaterThan(0);
  });

  it("puts the flaming head on the board's leader", () => {
    renderTV("board", "october");
    expect(screen.getByText("THE LEADER HOLDS THE FLAMING HEAD")).toBeInTheDocument();
    expect(screen.getByTestId("tv-grid-standing-1")).toContainElement(screen.getByTestId("october-flaming-head"));
  });

  it("draws still on the host's phone preview", () => {
    renderTV("question", "october", "still");
    expect(screen.getByTestId("october-patch")).toHaveAttribute("data-world-tier", "still");
  });

  it("switches itself off if it breaks, and the question stays on screen without restarting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const night = demoNight({ moment: "question", nowMs: Date.parse("2026-10-07T23:50:00Z"), secondsLeft: 14, locked: 10 });
    const tv = (n: number) => (
      <ThemeProvider themeKey="october">
        <TVStateMachine
          snapshot={{ ...night.snapshot, night: { ...night.snapshot.night, themeKey: "october" }, players: night.snapshot.players.slice(0, n) }}
          lastBroadcastRevealedAt={night.revealedAt}
          themeKey="october"
        />
      </ThemeProvider>
    );
    const { rerender } = render(tv(29));
    const questionBefore = screen.getByTestId("tv-question");
    crash.patch = true;
    rerender(tv(28));
    await waitFor(() => expect(screen.getByTestId("october-world")).toHaveAttribute("data-world-off", "true"));
    expect(screen.queryByTestId("october-patch")).toBeNull();
    // The plain screen takes over: it paints its own background again…
    expect(screen.getByTestId("tv-question")).not.toHaveAttribute("data-stage-world");
    expect(screen.getByText("New York City")).toBeInTheDocument();
    // …and the question view was never torn down (its clock didn't restart).
    expect(screen.getByTestId("tv-question")).toBe(questionBefore);
  });

  it("leaves out players who have gone home, unless they answered this question", async () => {
    const now = Date.now();
    const night = demoNight({ moment: "question", nowMs: now, secondsLeft: 14, locked: 0 });
    const stale = new Date(now - 45 * 60_000).toISOString();
    const players = night.snapshot.players.map((p, i) => (i < 4 ? { ...p, lastSeenAt: stale } : p));
    // One of the long-gone players answers this question after all.
    const liveAnswers = [
      {
        question_id: night.snapshot.liveQuestionId!,
        player_key: players[0].id,
        player_name: players[0].displayName,
        ms_to_lock: 3000,
        is_correct: null,
        chosen_index: null,
      },
    ];
    render(
      <ThemeProvider themeKey="october">
        <TVStateMachine
          snapshot={{ ...night.snapshot, players, liveAnswers }}
          lastBroadcastRevealedAt={night.revealedAt}
          lastBroadcastServerNow={new Date(now).toISOString()}
          themeKey="october"
        />
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("october-world")).toHaveAttribute("data-world-pumpkins", String(29 - 3)),
    );
  });

  it("gives pumpkins only to the players in this game, not everyone in the room", async () => {
    const now = Date.now();
    const night = demoNight({ moment: "question", nowMs: now, secondsLeft: 14, locked: 0 });
    // Game 2 is opt-in: 6 of the room's 29 players sat it out, so the scores
    // feed (one row per game player) has 23 rows.
    const scores = night.snapshot.scores.slice(0, 23);
    render(
      <ThemeProvider themeKey="october">
        <TVStateMachine
          snapshot={{ ...night.snapshot, scores, liveAnswers: [] }}
          lastBroadcastRevealedAt={night.revealedAt}
          lastBroadcastServerNow={new Date(now).toISOString()}
          themeKey="october"
        />
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("october-world")).toHaveAttribute("data-world-pumpkins", "23"),
    );
  });

  it("lets the Horseman finish his ride after the screen switches to the reveal", async () => {
    const now = Date.now();
    const revealedAtMs = now - 24_000; // 1 s left: he is riding
    const q = demoNight({ moment: "question", nowMs: now, revealedAtMs, locked: 10 });
    const r = demoNight({ moment: "reveal", nowMs: now, revealedAtMs, locked: 10 });
    const tv = (snap: typeof q) => (
      <ThemeProvider themeKey="october">
        <TVStateMachine
          snapshot={snap.snapshot}
          lastBroadcastRevealedAt={snap.revealedAt}
          lastBroadcastServerNow={new Date(now).toISOString()}
          themeKey="october"
        />
      </ThemeProvider>
    );
    const { rerender } = render(tv(q));
    const world = screen.getByTestId("october-world");
    await waitFor(() => expect(world).toHaveAttribute("data-world-horseman", "ride"));
    rerender(tv(r));
    await waitFor(() => expect(world).toHaveAttribute("data-world-moment", "reveal"));
    expect(world).toHaveAttribute("data-world-horseman", "ride");
  });
});

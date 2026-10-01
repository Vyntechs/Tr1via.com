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
  it("is not mounted on any other theme; the screens render exactly as before", () => {
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

  it("switches itself off if it breaks, and the question stays on screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    crash.patch = true;
    renderTV("question", "october");
    await waitFor(() => expect(screen.queryByTestId("october-world")).toBeNull());
    expect(screen.getByTestId("tv-question")).not.toHaveAttribute("data-stage-world");
    expect(screen.getByText("New York City")).toBeInTheDocument();
  });
});

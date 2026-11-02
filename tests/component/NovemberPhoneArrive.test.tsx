// November · the lobby turkey waits for its pictures (slow venue wifi), and
// the question / locked / wrong-answer screens show night in game 2.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/system";
import { PlayerLocked, PlayerQuestion, PlayerRevealWrong } from "@/components/player";
import { YourTurkey } from "@/components/experience/november/YourTurkey";
import { NovemberGameNoContext } from "@/components/experience/november/phoneContext";
import { resetNovemberPhoneArtForTests } from "@/components/experience/november/preloadPhoneArt";
import { PHONE_ART_WAIT_MS, PHONE_WALK_MS } from "@/lib/experience/november/phone";
import type { ThemeKey } from "@/lib/theme/tokens";

// An Image that loads only when the test says so.
class FakeImage extends EventTarget {
  static all: FakeImage[] = [];
  decoding = "";
  complete = false;
  naturalWidth = 0;
  src = "";
  listeners = 0;
  constructor() {
    super();
    FakeImage.all.push(this);
  }
  addEventListener(...a: Parameters<EventTarget["addEventListener"]>) {
    this.listeners++;
    super.addEventListener(...a);
  }
  removeEventListener(...a: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners--;
    super.removeEventListener(...a);
  }
  settle(ok: boolean) {
    this.complete = true;
    this.naturalWidth = ok ? 256 : 0;
    this.dispatchEvent(new Event(ok ? "load" : "error"));
  }
}
const img = (part: string) => {
  const found = FakeImage.all.find((i) => i.src.includes(part));
  if (!found) throw new Error(`no picture requested for ${part}`);
  return found;
};
const turkey = () => screen.getByTestId("your-turkey");
const anim = () => turkey().getAttribute("data-turkey-anim");
const play = () => turkey().getAttribute("data-turkey-play");
const lobbyTurkey = () =>
  render(
    <ThemeProvider themeKey="november">
      <YourTurkey mood="arrive" size={160} />
    </ThemeProvider>,
  );

describe("lobby turkey waits for its pictures", () => {
  beforeEach(() => {
    FakeImage.all = [];
    resetNovemberPhoneArtForTests();
    vi.stubGlobal("Image", FakeImage);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetNovemberPhoneArtForTests();
  });

  it("asks for the walk and standing strips at once, and paints nothing until the walk is in", () => {
    lobbyTurkey();
    expect(img("/walk-256").src).toContain("walk-256");
    expect(img("/idle-256").src).toContain("idle-256");
    expect(anim()).toBe("pending");
    expect(screen.queryByTestId("your-turkey-frame")).toBeNull();
    // The walk clock has not started: a long wait still shows nothing walking.
    act(() => vi.advanceTimersByTime(PHONE_WALK_MS + 100));
    expect(anim()).toBe("pending");
  });

  it("walks once the walk strip loads, then stands when the standing strip is in", () => {
    lobbyTurkey();
    act(() => img("/idle-256").settle(true));
    act(() => img("/walk-256").settle(true));
    expect(anim()).toBe("walk");
    expect(play()).toBe("loop");
    act(() => vi.advanceTimersByTime(PHONE_WALK_MS));
    expect(anim()).toBe("idle");
    expect(play()).toBe("loop");
  });

  it("holds the walk's last frame until a late standing strip arrives", () => {
    lobbyTurkey();
    act(() => img("/walk-256").settle(true));
    act(() => vi.advanceTimersByTime(PHONE_WALK_MS));
    expect(anim()).toBe("walk");
    expect(play()).toBe("still");
    expect(screen.getByTestId("your-turkey-frame")).toBeInTheDocument();
    act(() => img("/idle-256").settle(true));
    expect(anim()).toBe("idle");
  });

  it("keeps the walk frame if the standing strip never comes (never goes blank)", () => {
    lobbyTurkey();
    act(() => img("/walk-256").settle(true));
    act(() => vi.advanceTimersByTime(PHONE_ART_WAIT_MS + PHONE_WALK_MS));
    expect(anim()).toBe("walk");
    expect(play()).toBe("still");
  });

  it("a very late standing strip still takes over from the held walk frame", () => {
    lobbyTurkey();
    act(() => img("/walk-256").settle(true));
    act(() => vi.advanceTimersByTime(PHONE_WALK_MS + PHONE_ART_WAIT_MS + 500));
    expect(play()).toBe("still");
    act(() => img("/idle-256").settle(true));
    expect(anim()).toBe("idle");
    expect(play()).toBe("loop");
  });

  it("walk never loads, standing strip lands late: still turkey, then idling", () => {
    lobbyTurkey();
    act(() => vi.advanceTimersByTime(PHONE_ART_WAIT_MS + 500));
    expect(play()).toBe("still");
    act(() => img("/idle-256").settle(true));
    expect(anim()).toBe("idle");
    expect(play()).toBe("loop");
  });

  it("falls back to the still standing turkey when the walk never loads", () => {
    lobbyTurkey();
    act(() => vi.advanceTimersByTime(PHONE_ART_WAIT_MS));
    expect(anim()).toBe("idle");
    expect(play()).toBe("still");
    expect(screen.getByTestId("your-turkey-frame")).toBeInTheDocument();
  });

  it("skips the walk when its picture errors", () => {
    lobbyTurkey();
    act(() => img("/walk-256").settle(false));
    act(() => img("/idle-256").settle(true));
    expect(anim()).toBe("idle");
    expect(play()).toBe("loop");
  });

  it("uses a picture already loaded by the preload sets straight away", () => {
    const first = lobbyTurkey();
    act(() => img("/walk-256").settle(true));
    act(() => img("/idle-256").settle(true));
    first.unmount();
    lobbyTurkey();
    expect(anim()).toBe("walk");
    expect(FakeImage.all.length).toBe(2);
  });

  it("removes its listeners and timers on unmount", () => {
    const { unmount } = lobbyTurkey();
    act(() => img("/walk-256").settle(true));
    unmount();
    expect(FakeImage.all.every((i) => i.listeners === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reduced motion: the still turkey, no walk", () => {
    const mm = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (q: string) => ({
        matches: q.includes("reduce"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    try {
      lobbyTurkey();
      expect(anim()).toBe("idle");
      expect(play()).toBe("still");
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: mm });
    }
  });
});

describe("game 2 sky on the November phone", () => {
  const inGame = (themeKey: ThemeKey, gameNo: number | null, node: ReactNode) =>
    render(
      <ThemeProvider themeKey={themeKey}>
        <NovemberGameNoContext.Provider value={gameNo}>{node}</NovemberGameNoContext.Provider>
      </ThemeProvider>,
    );
  const screens: Array<[string, ReactNode]> = [
    ["player-question", <PlayerQuestion key="q" seconds={12} />],
    ["player-locked", <PlayerLocked key="l" chosenSlot={2} seconds={9} />],
    ["player-reveal-wrong", <PlayerRevealWrong key="w" chosenSlot={1} />],
  ];

  it("dusk in game 1, night in game 2, dusk with no room", () => {
    for (const [id, node] of screens) {
      for (const [gameNo, sky] of [[1, "dusk"], [2, "night"], [null, "dusk"]] as const) {
        const { unmount } = inGame("november", gameNo, node);
        expect(screen.getByTestId(id).getAttribute("data-harvest-sky"), `${id} game ${gameNo}`).toBe(sky);
        unmount();
      }
    }
  });

  it("other months never get a field, in either game", () => {
    for (const k of ["october", "september", "house"] as ThemeKey[]) {
      for (const [id, node] of screens) {
        const { unmount } = inGame(k, 2, node);
        expect(screen.getByTestId(id).getAttribute("data-harvest-sky")).toBeNull();
        unmount();
      }
    }
  });
});

// PlayerLocked — the quiet send-status line (Sending → Locked in, retrying,
// time's up) on every theme. One calm line inside the existing timer strip:
// no new colours, no loud banner, and nothing animates under reduced motion.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/system";
import { PlayerLocked, type PlayerLockedSendState } from "@/components/player";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";

let reducedMotion = false;
vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

afterEach(() => {
  cleanup();
  reducedMotion = false;
});

const wrap = (themeKey: ThemeKey, node: ReactNode) =>
  render(<ThemeProvider themeKey={themeKey}>{node}</ThemeProvider>);
const status = () => screen.getByTestId("player-send-status");

const CASES: Array<[PlayerLockedSendState, string]> = [
  ["sending", "Sending…"],
  ["retrying", "Didn’t go through — retrying"],
  ["locked", "Locked in"],
  ["unconfirmed", "We couldn’t confirm your answer"],
  ["rejected", "Couldn’t send your answer"],
];

describe("PlayerLocked send status", () => {
  it("has 14 themes to cover", () => {
    expect(THEME_KEYS).toHaveLength(14);
  });

  describe.each(THEME_KEYS)("%s", (themeKey) => {
    it.each(CASES)("%s: says the right thing and keeps the choice and the four answers", (state, text) => {
      wrap(
        themeKey,
        <PlayerLocked
          chosenSlot={3}
          msToLock={null}
          sendState={state}
          options={["One", "Two", "Three", "Four"]}
        />,
      );
      expect(status()).toHaveAttribute("data-send-state", state);
      expect(status()).toHaveTextContent(text);
      for (const option of ["One", "Two", "Three", "Four"]) {
        expect(screen.getByText(option)).toBeInTheDocument();
      }
      // The strip is a polite live region, so it is announced without stealing focus.
      expect(status()).toHaveAttribute("aria-live", "polite");
    });
  });

  it("claims no lock time until the saved row supplies one", () => {
    wrap("house", <PlayerLocked chosenSlot={2} msToLock={null} sendState="locked" />);
    expect(status()).toHaveTextContent("Locked in");
    expect(status()).not.toHaveTextContent(/locked at|speed bonus|\ds\b/i);
  });

  it("shows the real time once the saved row has it", () => {
    wrap("house", <PlayerLocked chosenSlot={2} msToLock={2300} sendState="locked" />);
    expect(status()).toHaveTextContent("LOCKED AT");
    expect(status()).toHaveTextContent("2.3s");
  });

  it("only says 'Answer saved.' (Room Magic) once locked, but keeps the line's height the whole time", () => {
    const { rerender } = wrap(
      "house",
      <PlayerLocked chosenSlot={2} msToLock={null} sendState="sending" roomMagicEnabled />,
    );
    const line = screen.getByTestId("player-house-lights-confirmation");
    expect(line).not.toHaveTextContent("Answer saved.");
    expect(line.style.minHeight).toBe("18px");
    rerender(
      <ThemeProvider themeKey="house">
        <PlayerLocked chosenSlot={2} msToLock={null} sendState="locked" roomMagicEnabled />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("player-house-lights-confirmation")).toBe(line);
    expect(line).toHaveTextContent("Answer saved.");
  });

  it("the cards never replay their entrance on the locked screen", () => {
    wrap("house", <PlayerLocked chosenSlot={1} msToLock={null} sendState="sending" />);
    for (const n of [1, 2, 3, 4]) {
      const card = screen.getByText(String(n)).closest("div[style*='border-radius: 14px']") as HTMLElement;
      expect(card.style.animation).toBe("none");
    }
  });

  it("uses only the theme's own colours: no red banner, no new fills", () => {
    wrap("house", <PlayerLocked chosenSlot={1} msToLock={null} sendState="retrying" />);
    const html = status().innerHTML;
    expect(html).not.toMatch(/var\(--wrong\)|#FFF\b|box-shadow/i);
  });

  it("pulses the dot while sending/retrying, and holds still under reduced motion", () => {
    const { rerender } = wrap("house", <PlayerLocked chosenSlot={1} msToLock={null} sendState="sending" />);
    expect(screen.getByTestId("player-send-dot").style.animation).toContain("tr1via-pulse");
    reducedMotion = true;
    rerender(
      <ThemeProvider themeKey="house">
        <PlayerLocked chosenSlot={1} msToLock={null} sendState="retrying" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("player-send-dot")).toHaveStyle({ animation: "none" });
  });

  it("October: the pumpkin stays unlit until the server says yes, then lights", () => {
    const { rerender } = wrap("october", <PlayerLocked chosenSlot={2} msToLock={null} sendState="sending" />);
    const mood = () => screen.getByTestId("your-pumpkin").getAttribute("data-pumpkin-mood");
    expect(mood()).toBe("waiting");
    rerender(
      <ThemeProvider themeKey="october">
        <PlayerLocked chosenSlot={2} msToLock={null} sendState="locked" />
      </ThemeProvider>,
    );
    expect(mood()).toBe("lit");
  });

  it("'rejected' offers one quiet Try again that sends the same answer again", () => {
    const onRetry = vi.fn();
    wrap("house", <PlayerLocked chosenSlot={2} msToLock={null} sendState="rejected" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("the gallery/demo default is unchanged: locked, with its sample time", () => {
    wrap("house", <PlayerLocked />);
    expect(status()).toHaveAttribute("data-send-state", "locked");
    expect(status()).toHaveTextContent("LOCKED AT");
    expect(status()).toHaveTextContent("2.3s");
  });
});

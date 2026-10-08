// PlayerQuestion with `pick` — the tap changes the SAME screen in place. The
// question text, the strip and the four cards are the very same elements before
// and after (a remount is what made them jump), the entrance never replays,
// and the status strip reserves its height from the start. (Real positions are
// measured in a browser by tests/e2e/phone-instant-lock.spec.ts.)

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerQuestion, type PlayerQuestionPick } from "@/components/player";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import type { PlayerLockedSendState } from "@/components/player/PlayerSendStatus";

let reducedMotion = false;
vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

afterEach(() => {
  cleanup();
  reducedMotion = false;
});

const OPTIONS: [string, string, string, string] = ["Alpha", "Bravo", "Charlie", "Delta"];

function screenFor(themeKey: ThemeKey, pick?: PlayerQuestionPick, extra: { roomMagicEnabled?: boolean } = {}) {
  return (
    <ThemeProvider themeKey={themeKey}>
      <PlayerQuestion
        category="Geography"
        options={OPTIONS}
        prompt="Which state is largest?"
        onTap={() => {}}
        pick={pick}
        {...extra}
      />
    </ThemeProvider>
  );
}

const cardNodes = (prefix: "player-answer" | "player-locked-answer") =>
  [1, 2, 3, 4].map((n) => screen.getByTestId(`${prefix}-${n}`));

describe("PlayerQuestion in-place lock", () => {
  it.each(THEME_KEYS)("%s: the tap keeps the same question text, strip and four cards (no remount)", (themeKey) => {
    const { rerender } = render(screenFor(themeKey));
    const prompt = screen.getByTestId("player-question-prompt");
    const cards = cardNodes("player-answer");
    expect(cards).toHaveLength(4);
    const animations = cards.map((c) => c.style.animation);
    const stripBefore = cards[0]!.parentElement!.previousElementSibling as HTMLElement;
    const root = screen.getByTestId("player-question");

    rerender(screenFor(themeKey, { chosenSlot: 2, sendState: "sending", msToLock: null }));

    // Same screen element, same prompt element, same card elements.
    expect(screen.getByTestId("player-locked")).toBe(root);
    expect(screen.getByTestId("player-question-prompt")).toBe(prompt);
    expect(prompt).toHaveTextContent("Which state is largest?");
    const after = cardNodes("player-locked-answer");
    after.forEach((card, i) => expect(card).toBe(cards[i]));
    // Cards stay buttons (so focus and the element survive) but are not pressable.
    after.forEach((card) => {
      expect(card.tagName).toBe("BUTTON");
      expect(card).toHaveAttribute("aria-disabled", "true");
    });
    // Nothing re-triggers the rise-in entrance.
    after.forEach((card, i) => expect(card.style.animation).toBe(animations[i]));
    expect(after[0]!.style.animation).toContain("backwards");
    // Chosen card marked, the others dimmed.
    expect(after[1]!.style.opacity).toBe("1");
    for (const i of [0, 2, 3]) expect(after[i]!.style.opacity).toBe("0.32");
    // The strip is the same element and already had the status height reserved.
    const stripAfter = after[0]!.parentElement!.previousElementSibling as HTMLElement;
    expect(stripAfter).toBe(stripBefore);
    expect(stripBefore.style.minHeight).toBe("69px");
    expect(screen.getByTestId("player-send-status")).toHaveAttribute("data-send-state", "sending");
  });

  it("goes Sending → Locked in on the same cards, and the 4 cards never change tag or style size", () => {
    const { rerender } = render(screenFor("house", { chosenSlot: 3, sendState: "sending", msToLock: null }));
    const cards = cardNodes("player-locked-answer");
    const sizing = cards.map((c) => [c.style.minHeight, c.style.border]);
    for (const state of ["locked", "retrying", "unconfirmed"] as PlayerLockedSendState[]) {
      rerender(screenFor("house", { chosenSlot: 3, sendState: state, msToLock: null }));
      cardNodes("player-locked-answer").forEach((c, i) => expect(c).toBe(cards[i]));
      cards.forEach((c, i) => expect([c.style.minHeight, c.style.border]).toEqual(sizing[i]));
    }
    expect(screen.getByTestId("player-send-status")).toHaveTextContent("We couldn’t confirm your answer");
  });

  it("the chosen card always has room for its mark, so its text wraps the same as before the tap", () => {
    render(screenFor("house"));
    // A (hidden) placeholder of the mark's size is present on every card already.
    for (const card of cardNodes("player-answer")) {
      const mark = card.querySelector('span[aria-hidden="true"]') as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.style.visibility).toBe("hidden");
      expect(mark.style.width).toBe("9px");
    }
  });

  it("an unknown card (server holds an answer, which card not known yet) marks none and dims all", () => {
    render(screenFor("house", { chosenSlot: null, sendState: "locked", msToLock: null }));
    for (const card of cardNodes("player-locked-answer")) expect(card.style.opacity).toBe("0.32");
    expect(screen.getByTestId("player-send-status")).toHaveTextContent("Locked in");
  });

  it("after a refusal the other cards wake up and can be picked, the refused one stays marked", () => {
    const onPick = vi.fn();
    const onRetry = vi.fn();
    render(screenFor("house", { chosenSlot: 2, sendState: "rejected", msToLock: null, onPick, onRetry }));
    const [c1, c2, c3] = cardNodes("player-locked-answer");
    expect(c2).toHaveAttribute("aria-disabled", "true");
    expect(c2!.style.opacity).toBe("1");
    expect(c1).not.toHaveAttribute("aria-disabled");
    fireEvent.click(c3!);
    expect(onPick).toHaveBeenCalledWith(3);
    fireEvent.click(c2!); // the refused card is not a pick
    expect(onPick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("digit keys do nothing once locked, and pick again only after a refusal", () => {
    const onPick = vi.fn();
    const { rerender } = render(screenFor("house", { chosenSlot: 1, sendState: "sending", msToLock: null, onPick }));
    fireEvent.keyDown(document, { key: "3" });
    expect(onPick).not.toHaveBeenCalled();
    rerender(screenFor("house", { chosenSlot: 1, sendState: "rejected", msToLock: null, onPick }));
    fireEvent.keyDown(document, { key: "3" });
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("reduced motion: no fade between the plain and the dimmed card, and the status dot holds still", () => {
    reducedMotion = true;
    render(screenFor("house", { chosenSlot: 2, sendState: "sending", msToLock: null }));
    for (const card of cardNodes("player-locked-answer")) expect(card.style.transition).toBe("none");
    expect(screen.getByTestId("player-send-dot").style.animation).toBe("none");
    expect(screen.getByTestId("player-waiting-pulse-dot").style.animation).toBe("none");
  });

  it("Room Magic: the 'Answer saved.' line holds its place before and after, and speaks only once locked", () => {
    const { rerender } = render(screenFor("house", undefined, { roomMagicEnabled: true }));
    const line = screen.getByTestId("player-house-lights-confirmation");
    expect(line).not.toHaveTextContent("Answer saved.");
    rerender(screenFor("house", { chosenSlot: 2, sendState: "sending", msToLock: null }, { roomMagicEnabled: true }));
    expect(screen.getByTestId("player-house-lights-confirmation")).toBe(line);
    expect(line).not.toHaveTextContent("Answer saved.");
    rerender(screenFor("house", { chosenSlot: 2, sendState: "locked", msToLock: null }, { roomMagicEnabled: true }));
    expect(screen.getByTestId("player-house-lights-confirmation")).toBe(line);
    expect(line).toHaveTextContent("Answer saved.");
  });

  it("standings sit outside the flow (below the first screen), so they can never push the cards", () => {
    render(
      screenFor("house", {
        chosenSlot: 2,
        sendState: "locked",
        msToLock: 2300,
        standings: {
          top: [{ rank: 1, name: "Ada", score: 300, isYou: false }],
          you: { rank: 4, name: "Me", score: 100, isYou: true },
        },
      }),
    );
    const block = screen.getByTestId("player-locked-standings");
    expect(block.style.position).toBe("absolute");
    expect(block.style.top).toBe("100%");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByTestId("standings-you")).toBeInTheDocument();
  });
});

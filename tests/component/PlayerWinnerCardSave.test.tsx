// The winner's "Save your card" picture. html-to-image paints its
// backgroundColor onto the card itself and copies the card's top margin, so
// every month must put the accent back on the card and zero the margin for
// the saved copy (otherwise the PNG comes out near-black and cut off).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/system";
import { PlayerWinnerCard } from "@/components/player/PlayerWinnerCard";
import { TR1VIA_THEMES, type ThemeKey } from "@/lib/theme/tokens";

const h = vi.hoisted(() => ({ toPng: vi.fn(async () => "data:image/png;base64,AAAA") }));
vi.mock("html-to-image", () => ({ toPng: h.toPng }));

afterEach(() => h.toPng.mockClear());

async function saveFor(themeKey: ThemeKey) {
  render(
    <ThemeProvider themeKey={themeKey}>
      <PlayerWinnerCard />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByTestId("player-winner-download"));
  await waitFor(() => expect(h.toPng).toHaveBeenCalled());
  return h.toPng.mock.calls as unknown as Array<[HTMLElement, Record<string, unknown>]>;
}

describe("winner card save options", () => {
  it.each(["october", "september", "house", "daylight"] as ThemeKey[])(
    "%s saves with the accent on the card, zero margin, one pass, fresh images",
    async (themeKey) => {
      const calls = await saveFor(themeKey);
      expect(calls).toHaveLength(1);
      const opts = calls[0][1];
      expect(opts.backgroundColor).toBe(TR1VIA_THEMES[themeKey].paper);
      expect(opts.style).toEqual({ backgroundColor: TR1VIA_THEMES[themeKey].accent, margin: "0" });
      expect(opts.cacheBust).toBe(true);
    },
  );

  it("november keeps its warm-up pass and reuses cached pictures", async () => {
    const calls = await saveFor("november");
    expect(calls).toHaveLength(2);
    const opts = calls[1][1];
    expect(opts.style).toEqual({ backgroundColor: TR1VIA_THEMES.november.accent, margin: "0" });
    expect(opts.cacheBust).toBe(false);
  });

  it("does not change the card on screen", async () => {
    const calls = await saveFor("october");
    const card = calls[0][0];
    expect(card.style.marginTop).toBe("18px");
    expect(card.style.background).not.toBe("");
  });
});

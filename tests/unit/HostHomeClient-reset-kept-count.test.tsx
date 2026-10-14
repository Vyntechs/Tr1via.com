// After "Reset and edit game", the success text and the popup must name the
// same number of kept categories. The database reply counts every category
// row, so a night with a slot doubled before the one-per-slot fix said
// "kept 7" right after a popup that said 6. The popup counts board slots.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { HostHomeClient } from "@/app/host/HostHomeClient";
import { ThemeProvider } from "@/components/system/ThemeProvider";

const preview = {
  revealsToWipe: 3,
  adjustmentsToWipe: 0,
  answersToWipe: 12,
  finishedQuestionsToWipe: 3,
  categoriesKept: 6,
  pickedQuestionsKept: 42,
  playersInRoom: 4,
  categoryNamesSample: ["Ghost Stories", "Pumpkins"],
};

const props = {
  hostName: "Heather",
  hostSubtitle: "Host",
  defaultVenue: "Venue",
  isFirstNightComplete: true,
  previousGames: [],
  inSetup: [],
  lifetime: { nights: 1, questions: 42 },
  tonight: {
    nightId: "night-live",
    venue: "Venue",
    date: "Tue Oct 7",
    roomCode: "PF8NVJ",
    themeKey: "house" as const,
    status: "live" as const,
    isToday: true,
    resetPreview: preview,
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reset success text on a night with a doubled slot", () => {
  it("says the popup's slot count (6), not the database's row count (7)", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            wiped: { answers: 12 },
            kept: { categories: 7, players: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(
      <ThemeProvider themeKey="house">
        <HostHomeClient {...props} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId("host-reset-game-btn"));
    const popup = screen.getByLabelText("Reset game confirmation");
    expect(popup.textContent).toContain("6 categories");
    const confirm = within(popup)
      .getAllByRole("button")
      .find((button) => button.textContent !== "Cancel");
    fireEvent.click(confirm!);

    await waitFor(() => expect(screen.getByText(/Game rolled back/)).toBeTruthy());
    const message = screen.getByText(/Game rolled back/).textContent ?? "";
    expect(message).toContain("kept 6 categories");
    expect(message).not.toContain("kept 7 categories");
  });
});

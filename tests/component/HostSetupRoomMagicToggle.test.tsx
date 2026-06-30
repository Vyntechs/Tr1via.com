import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostSetupOverviewClient } from "@/app/host/setup/[nightId]/HostSetupOverviewClient";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import type { CategoryRow, GameRow } from "@/lib/supabase/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/components/host/gen", () => ({
  HostGenOverview: () => <div data-testid="host-gen-overview" />,
}));

const NIGHT_ID = "night-1";

function game(id: string, gameNo: 1 | 2, state: GameRow["state"]): GameRow {
  return {
    id,
    night_id: NIGHT_ID,
    game_no: gameNo,
    state,
  } as GameRow;
}

function renderSetup({
  roomMagicEnabled = false,
  live = false,
}: {
  roomMagicEnabled?: boolean;
  live?: boolean;
} = {}) {
  return render(
    <ThemeProvider themeKey="june">
      <HostSetupOverviewClient
        nightId={NIGHT_ID}
        venueName="Heather's"
        games={[
          game("game-1", 1, live ? "live" : "ready"),
          game("game-2", 2, "draft"),
        ]}
        categories={[] as CategoryRow[]}
        isOpen={false}
        initialThemeKey="june"
        hostDefaultThemeKey="june"
        initialRoomMagicEnabled={roomMagicEnabled}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Host setup Room Magic toggle", () => {
  it("renders the compact default-off toggle", () => {
    renderSetup();

    expect(screen.getByText("Room Magic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "On" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("optimistically saves the enabled state", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ roomMagicEnabled: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "On" }));

    expect(screen.getByRole("button", { name: "On" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/nights/${NIGHT_ID}/room-magic`,
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
    );
  });

  it("rolls back when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "Could not save Room Magic." }),
      })),
    );
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "On" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("disables the toggle while a game is live", () => {
    renderSetup({ live: true });

    expect(screen.getByRole("button", { name: "Off" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "On" })).toBeDisabled();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

import { ThemeProvider } from "@/components/system/ThemeProvider";
import { HostHomeClient } from "@/app/host/HostHomeClient";

const renderThemed = (node: ReactNode) =>
  render(<ThemeProvider themeKey="house">{node}</ThemeProvider>);

const baseProps = {
  hostName: "Heather",
  hostSubtitle: "Soul Fire Pizza",
  defaultVenue: "Soul Fire Pizza",
  isFirstNightComplete: true,
  previousGames: [],
  inSetup: [],
  lifetime: { nights: 20, questions: 1600 },
};

// Last week's night is the headline, exactly like Heather's dashboard on
// Oct 8, so the only create button is "+ Plan a new night".
const lastWeek = {
  nightId: "be6ad300-3782-4233-8740-62e5f19e978c",
  venue: "Soul Fire Pizza",
  date: "Sat Oct 3",
  dateLong: "Saturday night",
  isToday: false,
  roomCode: "PF8NVJ",
  themeKey: "october" as const,
  status: "setup" as const,
  resetPreview: null,
};

function pendingFetch() {
  let resolve: (value: Response) => void = () => {};
  const fetchMock = vi.fn(
    () => new Promise<Response>((r) => {
      resolve = r;
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, finish: (body: unknown) => resolve(new Response(JSON.stringify(body), { status: 201 })) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("creating a night is one tap, not two", () => {
  it("a second tap on '+ Plan a new night' while the first is running makes no second night", async () => {
    const { fetchMock, finish } = pendingFetch();
    renderThemed(<HostHomeClient {...baseProps} tonight={lastWeek} />);
    const button = screen.getByTestId("host-plan-new-night-btn");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Setting up…");

    finish({ nightId: "0993af1d-8571-4929-94e4-62d3392d44fc", roomCode: "EYBRKT" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/host/setup/0993af1d-8571-4929-94e4-62d3392d44fc"),
    );
    expect(push).toHaveBeenCalledTimes(1);
    // Stays locked while the page moves to the new night.
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the main 'Set up tonight's games' button is locked the same way", () => {
    const { fetchMock } = pendingFetch();
    renderThemed(<HostHomeClient {...baseProps} tonight={null} />);
    const button = screen.getByTestId("host-new-night-btn");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Setting up…");
  });

  it("unlocks after a failed create so the host can try again", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    renderThemed(<HostHomeClient {...baseProps} tonight={lastWeek} />);
    const button = screen.getByTestId("host-plan-new-night-btn");
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

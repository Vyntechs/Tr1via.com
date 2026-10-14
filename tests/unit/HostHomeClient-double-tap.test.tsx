import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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
  vi.useRealTimers();
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

// Every call waits until the test answers it, one answer per call, in order.
function heldFetches() {
  const answers: Array<(value: Response) => void> = [];
  const fetchMock = vi.fn(
    () => new Promise<Response>((r) => {
      answers.push(r);
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    answer: (i: number, body: unknown) => answers[i]!(new Response(JSON.stringify(body), { status: 201 })),
  };
}

const STALL_MESSAGE = "That is taking a while. Tap again; it will not make a second night.";
const NIGHT = { nightId: "0993af1d-8571-4929-94e4-62d3392d44fc", roomCode: "EYBRKT" };
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const buttons = [
  { name: "+ Plan a new night", testId: "host-plan-new-night-btn", props: { tonight: lastWeek } },
  { name: "Set up tonight's games", testId: "host-new-night-btn", props: { tonight: null } },
  {
    name: "the first-time welcome button",
    testId: "onboarding-setup-btn",
    props: { tonight: null, isFirstNightComplete: false },
  },
];

describe("bar wifi: the create button never stays grey", () => {
  for (const b of buttons) {
    it(`${b.name}: a stalled request unlocks after 10s with a plain message, and the retry asks for the same night`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { fetchMock, answer } = heldFetches();
      renderThemed(<HostHomeClient {...baseProps} {...b.props} />);
      const button = screen.getByTestId(b.testId);
      fireEvent.click(button);
      await wait(9_000);
      expect(button).toBeDisabled();
      await wait(1_100);
      expect(button).not.toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(STALL_MESSAGE);

      fireEvent.click(button);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Same request both times, no "make a new one" marker: the server's
      // one-night-per-tap rule hands back the night the first tap made.
      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      expect(calls[1]![0]).toBe(calls[0]![0]);
      expect(calls[1]![1].body).toBe(calls[0]![1].body);
      expect(calls[1]![1].headers).toEqual(calls[0]![1].headers);

      // The first tap's late answer is ignored; the retry's answer opens it.
      answer(0, NIGHT);
      await wait(0);
      expect(push).not.toHaveBeenCalled();
      answer(1, NIGHT);
      await waitFor(() => expect(push).toHaveBeenCalledWith(`/host/setup/${NIGHT.nightId}`));
      expect(push).toHaveBeenCalledTimes(1);
    });
  }

  it("unlocks when the night was made but the page never changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock, answer } = heldFetches();
    renderThemed(<HostHomeClient {...baseProps} tonight={lastWeek} />);
    const button = screen.getByTestId("host-plan-new-night-btn");
    fireEvent.click(button);
    answer(0, NIGHT);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    await wait(10_100);
    expect(button).not.toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(STALL_MESSAGE);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failed request unlocks at once with the error, and the stall timer does not fire later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    renderThemed(<HostHomeClient {...baseProps} tonight={lastWeek} />);
    const button = screen.getByTestId("host-plan-new-night-btn");
    fireEvent.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    await wait(11_000);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("the founder 'Build a full game' tool unlocks too, but gives the build a full minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock } = heldFetches();
    renderThemed(<HostHomeClient {...baseProps} tonight={lastWeek} isFounder />);
    const button = screen.getByRole("button", { name: /build a full game/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await wait(15_000);
    expect(button).toBeDisabled();
    await wait(46_000);
    expect(button).not.toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/taking a while/);
  });
});

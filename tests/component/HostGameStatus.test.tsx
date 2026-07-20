import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostGameStatus } from "@/components/host/HostGameStatus";
import { ThemeProvider } from "@/components/system";
import { useGameDelivery, useSurfaceObservation } from "@/lib/hooks/useGameDelivery";
import { MONTH_THEME_KEYS } from "@/lib/theme/monthThemeScript";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

const canonical = { runId: "run", roomRevision: 9, controlRevision: 4, playId: "play" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderStatus(delivery: React.ComponentProps<typeof HostGameStatus>["delivery"]) {
  return render(
    <ThemeProvider themeKey="november">
      <HostGameStatus
        stage="question-live"
        playerCount={31}
        lockedCount={23}
        delivery={delivery}
      />
    </ThemeProvider>,
  );
}

describe("HostGameStatus delivery receipt", () => {
  it.each(MONTH_THEME_KEYS)("inherits the %s monthly theme tokens", (themeKey) => {
    const theme = TR1VIA_THEMES[themeKey];
    render(
      <ThemeProvider themeKey={themeKey}>
        <HostGameStatus
          stage="question-live"
          playerCount={31}
          lockedCount={23}
          delivery={{ tv: "current", currentPhones: 31, recoveringPhones: 0 }}
        />
      </ThemeProvider>,
    );

    const status = screen.getByRole("region", { name: "Game Status" });
    expect(status).toHaveStyle({
      "--host-status-ink": theme.ink,
      "--host-status-success": theme.correct,
      "--host-status-danger": theme.wrong,
      "--host-status-accent": theme.accent,
    });
  });

  it("uses the exact restrained all-current labels", () => {
    renderStatus({ tv: "current", currentPhones: 31, recoveringPhones: 0, isSending: false });
    expect(screen.getByText("TV live ✓")).toBeVisible();
    expect(screen.getByText("31 phones live ✓")).toBeVisible();
    expect(screen.getByText("Shown everywhere")).toBeVisible();
  });

  it("does not present the last receipt as settled while the next request is sending", () => {
    renderStatus({ tv: "current", currentPhones: 30, recoveringPhones: 1, isSending: true });
    expect(screen.getByText("Sending…")).toBeVisible();
    expect(screen.queryByText("TV live ✓")).not.toBeInTheDocument();
    expect(screen.queryByText("30 phones live ✓")).not.toBeInTheDocument();
    expect(screen.queryByText("Shown everywhere")).not.toBeInTheDocument();
  });

  it("never turns an unknown receipt into a checked delivery claim", () => {
    renderStatus({ tv: "unknown", currentPhones: null, recoveringPhones: null, isSending: false });
    expect(screen.getByText("Sending…")).toBeVisible();
    expect(screen.queryByText(/phones live ✓/)).not.toBeInTheDocument();
    expect(screen.queryByText("TV live ✓")).not.toBeInTheDocument();
    expect(screen.queryByText("Shown everywhere")).not.toBeInTheDocument();
  });
});

function SurfaceProbe({ enabled = true }: { enabled?: boolean }) {
  useSurfaceObservation({ endpoint: "/api/room/ABC234/observe", canonical, enabled });
  return <p>Canonical frame painted</p>;
}

function DeliveryProbe({ stageKey }: { stageKey: string }) {
  const receipt = useGameDelivery({ roomCode: "ABC234", canonical, stageKey });
  return <p>{receipt.tv}</p>;
}

describe("game delivery hooks", () => {
  it("posts only from the committed canonical surface", async () => {
    const fetchMock = vi.fn(() => {
      expect(screen.getByText("Canonical frame painted")).toBeVisible();
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SurfaceProbe />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/room/ABC234/observe",
      expect.objectContaining({ method: "POST", body: JSON.stringify(canonical) }),
    );
  });

  it("does not acknowledge an unreachable paint and resumes after recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<SurfaceProbe enabled={false} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(<SurfaceProbe enabled />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("retries a dropped observation acknowledgement on the existing heartbeat", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("ack dropped"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SurfaceProbe />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("converges from recovering to shown everywhere after the next truthful receipt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tv: "recovering",
        currentPhones: 29,
        recoveringPhones: 2,
        canonical,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tv: "current",
        currentPhones: 31,
        recoveringPhones: 0,
        canonical,
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    function StatusProbe() {
      const delivery = useGameDelivery({ roomCode: "ABC234", canonical, stageKey: "question-live" });
      return <HostGameStatus stage="question-live" playerCount={31} lockedCount={23} delivery={delivery} />;
    }

    render(<ThemeProvider themeKey="november"><StatusProbe /></ThemeProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("2 recovering — answer protected")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("Shown everywhere")).toBeVisible();
    expect(screen.getByText("31 phones live ✓")).toBeVisible();
  });

  it("hides settled delivery claims while the next revision is pending", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tv: "current",
        currentPhones: 31,
        recoveringPhones: 0,
        canonical,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    function StatusProbe({ stageKey }: { stageKey: string }) {
      const delivery = useGameDelivery({ roomCode: "ABC234", canonical, stageKey });
      return <HostGameStatus stage="board" playerCount={31} lockedCount={0} delivery={delivery} />;
    }

    const view = render(<ThemeProvider themeKey="november"><StatusProbe stageKey="board" /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText("Shown everywhere")).toBeVisible());

    view.rerender(<ThemeProvider themeKey="november"><StatusProbe stageKey="question-live" /></ThemeProvider>);
    expect(screen.getByText("Sending…")).toBeVisible();
    expect(screen.queryByText("Shown everywhere")).not.toBeInTheDocument();
    expect(screen.queryByText("TV live ✓")).not.toBeInTheDocument();
  });

  it("clears an all-current claim after a failed or mismatched poll", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tv: "current",
        currentPhones: 31,
        recoveringPhones: 0,
        canonical,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tv: "current",
        currentPhones: 31,
        recoveringPhones: 0,
        canonical: { ...canonical, controlRevision: 99 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    function StatusProbe({ stageKey }: { stageKey: string }) {
      const delivery = useGameDelivery({ roomCode: "ABC234", canonical, stageKey });
      return <HostGameStatus stage="board" playerCount={31} lockedCount={0} delivery={delivery} />;
    }

    const view = render(<ThemeProvider themeKey="november"><StatusProbe stageKey="board" /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText("Shown everywhere")).toBeVisible());
    view.rerender(<ThemeProvider themeKey="november"><StatusProbe stageKey="question-live" /></ThemeProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Shown everywhere")).not.toBeInTheDocument());
  });

  it("quietly omits delivery monitoring when the legacy path is active", () => {
    function DisabledProbe() {
      const delivery = useGameDelivery({ roomCode: "ABC234", canonical, stageKey: "board", enabled: false });
      return <HostGameStatus stage="board" playerCount={31} lockedCount={0} delivery={delivery} />;
    }
    render(<ThemeProvider themeKey="november"><DisabledProbe /></ThemeProvider>);
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable|error|Game Sync/i)).not.toBeInTheDocument();
    expect(screen.getByText("31 players")).toBeVisible();
  });

  it("cancels and rekeys host polling when the stage changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        tv: "current",
        currentPhones: 31,
        recoveringPhones: 0,
        canonical,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<DeliveryProbe stageKey="board" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("current")).toBeVisible());

    view.rerender(<DeliveryProbe stageKey="question-live" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

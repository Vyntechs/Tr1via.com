import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostGameReady, type HostPreflight } from "@/components/host/HostGameReady";
import { ThemeProvider } from "@/components/system";
import { resolveTheme } from "@/lib/theme/resolve";
import { StrictMode } from "react";

function preflight(overrides: Partial<HostPreflight> = {}): HostPreflight {
  return {
    checks: {
      content: "ready",
      tv: "unknown",
      players: "unknown",
      network: "control-path-healthy",
      controls: "ready",
    },
    canStart: true,
    canStartMinimal: true,
    startReason: null,
    checkedAt: "2026-07-20T12:00:00.000Z",
    elapsedMs: 42,
    playerCount: 0,
    content: {
      gameId: "game-1",
      categoryCount: 1,
      expectedCategoryCount: 1,
      pickedQuestionCount: 1,
      expectedQuestionCount: 1,
      reason: null,
    },
    ...overrides,
  };
}

function renderReady(props: Partial<React.ComponentProps<typeof HostGameReady>> = {}) {
  const onCheck = props.onCheck ?? vi.fn().mockResolvedValue(preflight());
  const onStart = props.onStart ?? vi.fn();
  return {
    onCheck,
    onStart,
    ...render(
      <ThemeProvider themeKey="march">
        <HostGameReady
          roomCode="ABC123"
          preflight={preflight()}
          onCheck={onCheck}
          onStart={onStart}
          {...props}
        />
      </ThemeProvider>,
    ),
  };
}

describe("HostGameReady", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("uses theme tokens and never upgrades unknown observations into certainty", () => {
    const { container } = renderReady({
      preflight: preflight({ playerCount: 12 }),
    });

    expect(screen.getByRole("heading", { name: "Game 1 is ready for a final check" })).toBeVisible();
    expect(screen.getByText("3 confirmed · 2 not confirmed")).toBeVisible();
    expect(screen.queryByText(/5\s*(of|\/)\s*5/i)).not.toBeInTheDocument();
    expect(screen.getByText("Venue TV not confirmed")).toBeVisible();
    expect(screen.getByText("12 joined · phone delivery not confirmed")).toBeVisible();
    expect(screen.queryByText(/Venue TV connected|all devices current/i)).not.toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: resolveTheme("march").ink });
  });

  it("labels the waiting TV preview as expected and not observed", () => {
    renderReady();

    const preview = screen.getByRole("img", { name: "Expected venue TV preview — not observed" });
    expect(preview).toBeVisible();
    expect(preview).toHaveTextContent("ABC123");
    expect(screen.getByText("Expected venue TV · not observed")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open venue screen" })).not.toBeInTheDocument();
  });

  it("explains content, control-path, reachability, player, and TV truth", () => {
    renderReady();

    expect(screen.getByText("Saved Game 1 content is complete")).toBeVisible();
    expect(screen.getByText("Control path and database responded")).toBeVisible();
    expect(screen.getByText("Server round-trip healthy · venue Wi-Fi not measured")).toBeVisible();
    expect(screen.getByText("No players joined · rehearsal is allowed")).toBeVisible();
    expect(screen.getByText("Venue TV not confirmed")).toBeVisible();
  });

  it("starts Game 1 with the exact callback and keeps controls at least 48px", () => {
    const onStart = vi.fn();
    renderReady({ onStart });

    const check = screen.getByRole("button", { name: "Check TV & phones" });
    const start = screen.getByRole("button", { name: "Start Game 1" });
    expect(check).toHaveStyle({ minHeight: "48px" });
    expect(start).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("allows starting a partial board (matches the laptop) with a non-blocking note", () => {
    renderReady({
      preflight: preflight({
        checks: {
          ...preflight().checks,
          content: "invalid",
        },
        // Full board not built, but at least one ready category → startable,
        // exactly like the laptop console. Must NOT block the host.
        canStart: false,
        canStartMinimal: true,
        startReason: "Game 1 needs 7 picked questions before it can start.",
        content: {
          ...preflight().content,
          reason: "Game 1 needs 7 picked questions before it can start.",
        },
      }),
    });

    expect(screen.getByRole("button", { name: "Start Game 1" })).toBeEnabled();
    expect(
      screen.getByText("The board isn’t fully built yet — you can start now, or add more first."),
    ).toBeVisible();
  });

  it("blocks start only when nothing is startable (no ready category)", () => {
    renderReady({
      preflight: preflight({
        checks: { ...preflight().checks, content: "invalid" },
        canStart: false,
        canStartMinimal: false,
        startReason: "Game 1 has no questions yet — generate a category before starting.",
        content: { ...preflight().content, reason: "Game 1 has no questions yet." },
      }),
    });

    expect(screen.getByRole("button", { name: "Start Game 1" })).toBeDisabled();
    expect(
      screen.getByText("Game 1 has no questions yet — generate a category before starting."),
    ).toBeVisible();
  });

  it("uses the closed-night reason instead of mislabeling the TV", () => {
    renderReady({
      preflight: preflight({
        checks: { ...preflight().checks, controls: "unavailable" },
        canStart: false,
        canStartMinimal: false,
        startReason: "This trivia night is closed.",
      }),
    });

    expect(screen.getByRole("button", { name: "Start Game 1" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("This trivia night is closed.");
    expect(screen.queryByText("The venue TV surface is unavailable.")).not.toBeInTheDocument();
  });

  it("shows refresh progress and elapsed time before applying fresh evidence", async () => {
    let resolveCheck!: (value: HostPreflight) => void;
    const onCheck = vi.fn(() => new Promise<HostPreflight>((resolve) => { resolveCheck = resolve; }));
    renderReady({ onCheck });

    fireEvent.click(screen.getByRole("button", { name: "Check TV & phones" }));
    expect(screen.getByRole("button", { name: "Checking TV & phones…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Checking the control path…");

    resolveCheck(preflight({ elapsedMs: 187, playerCount: 3 }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked in 187 ms"));
    expect(screen.getByText("3 joined · phone delivery not confirmed")).toBeVisible();
  });

  it("surfaces a bounded refresh failure and never spins indefinitely", async () => {
    vi.useFakeTimers();
    const onCheck = vi.fn(() => new Promise<HostPreflight>(() => undefined));
    renderReady({ onCheck, refreshTimeoutMs: 100 });

    fireEvent.click(screen.getByRole("button", { name: "Check TV & phones" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(101); });

    expect(screen.getByRole("alert")).toHaveTextContent("Check timed out. Try again when the connection settles.");
    expect(screen.getByRole("button", { name: "Check TV & phones" })).toBeEnabled();
  });

  it("still applies refreshed evidence after the development StrictMode effect cycle", async () => {
    const onCheck = vi.fn().mockResolvedValue(preflight({ playerCount: 3, elapsedMs: 88 }));
    render(
      <StrictMode>
        <ThemeProvider themeKey="april">
          <HostGameReady
            roomCode="ABC123"
            preflight={preflight()}
            onCheck={onCheck}
            onStart={vi.fn()}
          />
        </ThemeProvider>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Check TV & phones" }));

    expect(await screen.findByText("3 joined · phone delivery not confirmed")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Checked in 88 ms");
  });
});

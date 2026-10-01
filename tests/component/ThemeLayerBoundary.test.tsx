// The theme safety net: a broken decoration layer switches itself off and the
// game screen around it keeps rendering.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// January's weather is a ParticleField. Make it blow up so we can prove the
// game screens survive a theme crash.
vi.mock("@/components/system/ParticleField", () => ({
  ParticleField: () => {
    throw new Error("theme effect exploded");
  },
}));

import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PhoneScreen } from "@/components/shells/PhoneScreen";
import { TVQuestion } from "@/components/tv/TVQuestion";

function Boom(): never {
  throw new Error("boom");
}

describe("ThemeLayerBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a healthy layer untouched, with no wrapper element", () => {
    const { container } = render(
      <ThemeLayerBoundary name="healthy">
        <span data-testid="layer">ok</span>
      </ThemeLayerBoundary>,
    );
    expect(screen.getByTestId("layer")).toHaveTextContent("ok");
    expect(container.firstChild).toBe(screen.getByTestId("layer"));
  });

  it("switches a failing layer off, tells onFail once, and leaves siblings alone", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onFail = vi.fn();
    render(
      <div>
        <ThemeLayerBoundary name="broken" onFail={onFail}>
          <Boom />
        </ThemeLayerBoundary>
        <p>the game</p>
      </div>,
    );
    expect(screen.getByText("the game")).toBeInTheDocument();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('"broken" switched off');
  });

  it("renders the fallback in place of a failed layer", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ThemeLayerBoundary name="broken" fallback={<p>plain version</p>}>
        <Boom />
      </ThemeLayerBoundary>,
    );
    expect(screen.getByText("plain version")).toBeInTheDocument();
  });

  it("keeps the venue TV question readable when the month's weather crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <TVQuestion
        themeKey="january"
        question="Which planet has the most moons?"
        options={[
          { n: 1, text: "Saturn" },
          { n: 2, text: "Jupiter" },
          { n: 3, text: "Uranus" },
          { n: 4, text: "Neptune" },
        ]}
        seconds={12}
        tiles={[]}
        totalPlayers={20}
      />,
    );
    expect(screen.getByTestId("tv-question")).toBeInTheDocument();
    expect(screen.getByText("Which planet has the most moons?")).toBeInTheDocument();
    expect(screen.getByText("Saturn")).toBeInTheDocument();
    expect(screen.getByText("0 OF 20 LOCKED IN")).toBeInTheDocument();
    expect(warn.mock.calls.some((call) => String(call[0]).includes("weather:january"))).toBe(true);
  });

  it("keeps a player's phone screen working when the month's weather crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ThemeProvider themeKey="january">
        <PhoneScreen data-testid="phone">
          <button type="button">Answer 2</button>
        </PhoneScreen>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("phone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Answer 2" })).toBeInTheDocument();
  });
});

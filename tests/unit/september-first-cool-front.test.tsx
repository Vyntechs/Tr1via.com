import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeptemberFront } from "@/components/system/SeptemberFront";
import { Weather, weatherLabel } from "@/components/system/Weather";
import { contrastRatio } from "@/lib/theme/contrast";
import { lockInCeremonyFor } from "@/lib/theme/lockInCeremony";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

afterEach(cleanup);

describe("September · First Cool Front identity", () => {
  it("uses the accessible warm-to-cool Texas palette", () => {
    expect(TR1VIA_THEMES.september).toEqual({
      name: "September · First Cool Front",
      mode: "dark",
      paper: "#132126",
      ink: "#F3E4C3",
      accent: "#D65A32",
      pop: "#72B8B0",
      correct: "#C8E25E",
      wrong: "#E58A7A",
    });
    expect(contrastRatio("#F3E4C3", "#132126")).toBeGreaterThanOrEqual(4.5);
  });

  it("replaces September's shared leaf drift without changing November", () => {
    const september = render(<Weather themeKey="september" />);
    expect(screen.getByTestId("september-front")).toBeInTheDocument();
    september.unmount();

    render(<Weather themeKey="november" />);
    expect(screen.queryByTestId("september-front")).toBeNull();
    expect(weatherLabel("november")).toBe("autumn drift");
    expect(weatherLabel("september")).toBe("the heat breaks by kickoff");
  });
});

describe("September atmosphere and control contract", () => {
  it("keeps the atmospheric layer decorative and clipped beneath content", () => {
    render(<SeptemberFront page="lobby" />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("september-front")).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("september-front-air-masses")).toBeInTheDocument();
    expect(screen.getByTestId("september-front-contours")).toBeInTheDocument();
    expect(screen.getByTestId("september-distant-stadium")).toBeInTheDocument();
    expect(screen.getByTestId("september-distant-stadium")).toHaveAttribute("data-stadium-mode", "full");
    expect(screen.getByTestId("september-stadium-horizon-glow")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-light-haze")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-lights")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-bowl")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-field")).toBeInTheDocument();
    expect(screen.getAllByTestId("september-stadium-lamp-head")).toHaveLength(2);
    expect(screen.getByTestId("september-stadium-silhouette")).toBeInTheDocument();
    expect(screen.queryByTestId("september-stadium-bleachers")).toBeNull();
    expect(screen.queryByTestId("september-stadium-perspective-lines")).toBeNull();
    expect(screen.getByTestId("september-friday-night-hashes")).toBeInTheDocument();
  });

  it("makes questions still while preserving the static September identity", () => {
    render(<Weather themeKey="september" page="question" />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-atmosphere", "quiet");
    expect(screen.getByTestId("september-front-air-masses")).toBeInTheDocument();
    expect(screen.queryByTestId("september-front-wind-veil")).toBeNull();
    expect(screen.getByTestId("september-distant-stadium")).toHaveAttribute("data-stadium-mode", "quiet");
    expect(screen.getByTestId("september-stadium-lights")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-bowl")).toBeInTheDocument();
    expect(screen.queryByTestId("september-stadium-field")).toBeNull();
    expect(screen.queryByTestId("september-friday-night-hashes")).toBeNull();
  });

  it("simplifies compact surfaces and forwards finale intensity", () => {
    render(<Weather themeKey="september" compact intensity={2.2} />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-compact", "true");
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-intensity", "2.2");
    expect(screen.queryByTestId("september-front-contours")).toBeNull();
    expect(screen.getByTestId("september-front-compact-edge")).toBeInTheDocument();
    expect(screen.getByTestId("september-distant-stadium")).toHaveAttribute("data-stadium-mode", "compact");
    expect(screen.queryByTestId("september-stadium-lamp-head")).toBeNull();
    expect(screen.queryByTestId("september-friday-night-hashes")).toBeNull();
    expect(screen.queryByTestId("september-front-wind-veil")).toBeNull();
  });

  it("uses state-specific static phases to carry the cool-front journey", () => {
    const lobby = render(<SeptemberFront page="lobby" />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-front-phase", "arrival");
    lobby.unmount();

    const intermission = render(<SeptemberFront page="intermission" />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-front-phase", "balanced");
    expect(screen.getByTestId("september-distant-stadium")).toHaveAttribute("data-stadium-mode", "results-safe");
    expect(screen.getAllByTestId("september-stadium-lamp-head")).toHaveLength(2);
    expect(screen.getByTestId("september-stadium-silhouette")).toBeInTheDocument();
    expect(screen.queryByTestId("september-friday-night-hashes")).toBeNull();
    intermission.unmount();

    render(<SeptemberFront page="finale" intensity={2.2} />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-front-phase", "clear");
  });

  it("gives the theme gallery a static, unmistakable stadium without player-control geometry", () => {
    render(<Weather themeKey="september" compact surface="card" />);
    expect(screen.getByTestId("september-distant-stadium")).toHaveAttribute("data-stadium-mode", "card");
    expect(screen.getAllByTestId("september-stadium-lamp-head")).toHaveLength(2);
    expect(screen.getByTestId("september-stadium-press-box")).toBeInTheDocument();
    expect(screen.queryByTestId("september-friday-night-hashes")).toBeNull();
  });

  it("yields completely when weather is off or the surface owns its background", () => {
    const off = render(<SeptemberFront intensity={0} />);
    expect(screen.queryByTestId("september-front")).toBeNull();
    off.unmount();

    render(<Weather themeKey="september" substrate={false} />);
    expect(screen.queryByTestId("september-front")).toBeNull();
  });

  it("does not change the timer, marquee, or lock-in ceremony", () => {
    expect(lockInCeremonyFor("september")).toEqual({
      duration: 30,
      marquee: false,
      ceremony: null,
    });
  });
});

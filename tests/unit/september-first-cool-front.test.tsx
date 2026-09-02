import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SeptemberFront,
  SeptemberQuestionLampBand,
} from "@/components/system/SeptemberFront";
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

  it("uses a September-specific homecoming drift without changing November", () => {
    const september = render(<Weather themeKey="september" />);
    expect(screen.getByTestId("september-front")).toBeInTheDocument();
    expect(screen.getByTestId("september-homecoming-drift")).toBeInTheDocument();
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
    expect(screen.getByTestId("september-stadium-light-beams")).toBeInTheDocument();
    expect(screen.getAllByTestId("september-stadium-lamp-head")).toHaveLength(2);
    expect(screen.getByTestId("september-stadium-silhouette")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-bleachers")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-goal-post")).toBeInTheDocument();
    expect(screen.queryByTestId("september-stadium-perspective-lines")).toBeNull();
    expect(screen.getByTestId("september-friday-night-hashes")).toBeInTheDocument();
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "falling");
    expect(screen.getAllByTestId("september-homecoming-leaf")).toHaveLength(4);
    expect(screen.getAllByTestId("september-homecoming-football")).toHaveLength(3);
    expect(screen.getAllByTestId("september-homecoming-pom")).toHaveLength(4);
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
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "static");
    expect(screen.getAllByTestId("september-homecoming-football")).toHaveLength(1);
    expect(screen.getAllByTestId("september-homecoming-pom")).toHaveLength(1);
  });

  it("keeps compact questions stadium-lit without putting field furniture behind answers", () => {
    render(
      <>
        <Weather themeKey="september" compact page="question" />
        <SeptemberQuestionLampBand />
      </>,
    );
    expect(screen.getAllByTestId("september-stadium-lamp-head")).toHaveLength(2);
    expect(screen.getByTestId("september-stadium-light-beams")).toBeInTheDocument();
    screen.getAllByTestId("september-stadium-lamp-head").forEach((lampHead) => {
      expect(lampHead).toHaveStyle({ opacity: "0.78" });
    });
    expect(screen.queryByTestId("september-stadium-goal-post")).toBeNull();
    expect(screen.queryByTestId("september-stadium-bleachers")).toBeNull();
    expect(screen.getAllByTestId("september-homecoming-football")).toHaveLength(1);
    expect(screen.getAllByTestId("september-homecoming-pom")).toHaveLength(1);
  });

  it("simplifies compact surfaces and forwards finale intensity", () => {
    render(<Weather themeKey="september" compact intensity={2.2} />);
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-compact", "true");
    expect(screen.getByTestId("september-front")).toHaveAttribute("data-intensity", "2.2");
    expect(screen.queryByTestId("september-front-contours")).toBeNull();
    expect(screen.getByTestId("september-front-compact-edge")).toBeInTheDocument();
    expect(screen.getByTestId("september-distant-stadium")).toHaveAttribute("data-stadium-mode", "compact");
    const compactLampHeads = screen.getAllByTestId("september-stadium-lamp-head");
    expect(compactLampHeads).toHaveLength(2);
    expect(compactLampHeads.map((lampHead) => lampHead.getAttribute("data-side"))).toEqual(["left", "right"]);
    compactLampHeads.forEach((lampHead) => {
      expect(lampHead.tagName.toLowerCase()).toBe("svg");
      expect(lampHead).toHaveAttribute("viewBox", "0 0 104 58");
      expect(lampHead).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
      expect(lampHead).toHaveStyle({ aspectRatio: "104 / 58", opacity: "0.9" });
      expect(lampHead.querySelectorAll("circle")).toHaveLength(12);
      expect(lampHead.querySelector('[data-testid="september-stadium-lamp-bank"]')).not.toBeNull();
      expect(lampHead.querySelector('[data-testid="september-stadium-lamp-yoke"]')).not.toBeNull();
    });
    expect(screen.getByTestId("september-stadium-light-beams")).toBeInTheDocument();
    expect(screen.getByTestId("september-stadium-goal-post")).toBeInTheDocument();
    expect(screen.queryByTestId("september-stadium-press-box")).toBeNull();
    expect(screen.getByTestId("september-homecoming-pennants")).toBeInTheDocument();
    expect(screen.getByTestId("september-homecoming-sign")).toHaveTextContent("HOMECOMING");
    expect(screen.queryByTestId("september-friday-night-hashes")).toBeNull();
    expect(screen.queryByTestId("september-front-wind-veil")).toBeNull();
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "falling");
    expect(screen.getAllByTestId("september-homecoming-leaf")).toHaveLength(2);
    expect(screen.getAllByTestId("september-homecoming-football")).toHaveLength(2);
    expect(screen.getAllByTestId("september-homecoming-pom")).toHaveLength(2);
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
    expect(
      Number.parseFloat(screen.getAllByTestId("september-homecoming-leaf")[0].style.opacity),
    ).toBeCloseTo(0.56 * 0.86, 5);
  });

  it("keeps each full-size lamp bank in-frame and visibly connected to its support", () => {
    const desktop = render(<SeptemberFront page="lobby" intensity={0.5} />);
    const desktopLamps = screen.getAllByTestId("september-stadium-lamp-head");
    expect(desktopLamps).toHaveLength(2);
    expect(desktopLamps.map((lamp) => lamp.tagName.toLowerCase())).toEqual(["g", "g"]);
    expect(desktopLamps.map((lamp) => lamp.getAttribute("transform"))).toEqual([
      "translate(18 148) scale(1)",
      "translate(1158 148) scale(1)",
    ]);
    desktopLamps.forEach((lamp) => {
      expect(lamp.querySelectorAll("circle")).toHaveLength(12);
      expect(lamp.querySelector('[data-testid="september-stadium-lamp-bank"]')).not.toBeNull();
      expect(lamp.querySelector('[data-testid="september-stadium-lamp-yoke"]')).not.toBeNull();
    });
    const supports = screen.getByTestId("september-stadium-lights");
    expect(supports).toHaveAttribute("stroke-opacity", ".8");
    const hostSupportAlpha =
      Number.parseFloat(screen.getByTestId("september-front").style.opacity) *
      0.5 *
      0.96 *
      Number.parseFloat(supports.getAttribute("stroke-opacity")!);
    expect(hostSupportAlpha).toBeGreaterThanOrEqual(0.25);
    desktop.unmount();

    render(<SeptemberFront page="question" />);
    const tvLamps = screen.getAllByTestId("september-stadium-lamp-head");
    expect(tvLamps.map((lamp) => lamp.getAttribute("transform"))).toEqual([
      "translate(19 184) scale(0.78)",
      "translate(1179 184) scale(0.78)",
    ]);
    tvLamps.forEach((lamp) => expect(lamp.querySelectorAll("circle")).toHaveLength(12));
  });

  it("makes footballs and pom-poms first-read on the dimmed host overview", () => {
    render(<SeptemberFront page="lobby" intensity={0.5} />);
    const frontOpacity = Number.parseFloat(screen.getByTestId("september-front").style.opacity);
    const football = screen.getAllByTestId("september-homecoming-football")[0];
    const pom = screen.getAllByTestId("september-homecoming-pom")[0];

    expect(Number.parseFloat(football.style.height)).toBeGreaterThanOrEqual(40);
    expect(Number.parseFloat(pom.style.height)).toBeGreaterThanOrEqual(44);
    expect(frontOpacity * 0.5 * Number.parseFloat(football.style.opacity)).toBeGreaterThanOrEqual(0.32);
    expect(frontOpacity * 0.5 * Number.parseFloat(pom.style.opacity)).toBeGreaterThanOrEqual(0.32);
    expect(football.style.animation).toContain("tr1via-september-keepsake-fall");
    expect(pom.style.animation).toContain("tr1via-september-keepsake-fall");
  });

  it("uses the complete open, quiet, card, and compact motion matrix", () => {
    for (const page of [undefined, "lobby", "board", "reveal", "leaderboard", "intermission", "finale"] as const) {
      const desktop = render(<SeptemberFront page={page} />);
      expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "falling");
      desktop.unmount();

      const compact = render(<SeptemberFront compact page={page} />);
      expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "falling");
      compact.unmount();
    }

    const question = render(<SeptemberFront compact page="question" />);
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "static");
    screen.getAllByTestId(/september-homecoming-(football|pom)/).forEach((keepsake) => {
      expect(keepsake.style.animation).toBe("");
    });
    question.unmount();

    const card = render(<SeptemberFront compact surface="card" />);
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "static");
    card.unmount();

    render(<SeptemberFront surface="card" />);
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "static");
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

// tests/unit/june-reveal-beat-mount-timing.test.tsx
//
// FORCING TEST for the live June "Endless Evening" reactive water — the sibling
// risk surfaced while fixing the May finale-lightning bug.
//
// The finale-lightning bug: a reaction signal (a counter bump) was emitted while
// the consuming subtree was not yet mounted, so the reaction was silently lost.
// The structural analog on the LIVE June path is `TVRevealView`
// (components/tv/TVStateMachine.tsx:589):
//
//     useEffect(() => { if (themeKey === "june") fireJuneBeat("reveal"); }, [themeKey]);
//
// `JuneSky` is mounted as a DESCENDANT of that view (TVRevealView → TVStage →
// Weather → JuneSky) and only reacts to a beat via its OWN subscription effect
// (JuneSky.tsx:51). If the ancestor's fire-on-mount effect ran before the
// descendant JuneSky subscribed, the "reveal" beat would fire into a Set that
// doesn't yet contain JuneSky's listener — and the water would never react. On a
// real TV that's the answer-reveal moment falling flat, silently.
//
// The audits CLAIMED this is safe "because React runs child effects before
// parent effects." This test PROVES it, against the real JuneSky, for the two
// real mount shapes: a fresh load straight into a reveal, and the live
// question→reveal SWAP (old JuneSky unmounts as the new one mounts and the beat
// fires in the same commit). If the ordering guarantee ever breaks, this fails.

import { useEffect, type ReactElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JuneSky, fireJuneBeat } from "@/components/system/JuneSky";

// Reduced-motion OFF, deterministically — otherwise JuneSky renders the static
// gradient and never subscribes, and the test would prove nothing.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mirrors TVRevealView: fires the reveal beat on mount, with JuneSky nested a
// couple levels down (as TVStage/Weather nest it on the real screen).
function RevealView() {
  useEffect(() => {
    fireJuneBeat("reveal");
  }, []);
  return (
    <div>
      <div>
        <JuneSky intensity={1} />
      </div>
    </div>
  );
}

// Mirrors TVQuestionView: the same JuneSky, no reveal beat.
function QuestionView() {
  return <JuneSky intensity={1} />;
}

function Stage({ phase }: { phase: "question" | "reveal" }) {
  return phase === "reveal" ? <RevealView /> : <QuestionView />;
}

// JuneSky renders 4 layers at rest; a received "reveal" beat flips `revealActive`
// and renders 2 MORE (the bloom + its water reflection). Counting child nodes is
// robust to CSS-string serialization quirks — it asks the only question that
// matters: did JuneSky actually react to the reveal?
function skyLayerCount(container: HTMLElement): number {
  const sky = container.querySelector('[data-testid="june-sky"]');
  if (!sky) throw new Error("JuneSky did not render (data-testid=june-sky missing)");
  return sky.children.length;
}

const RESTING_LAYERS = 4;
const REVEAL_LAYERS = 6; // resting 4 + bloom + reflection

describe("June reveal water-pulse fires the instant the reveal view mounts", () => {
  it("reacts when the reveal view is the FIRST thing mounted (TV loads straight into a reveal)", async () => {
    let container!: HTMLElement;
    await act(async () => {
      container = render(<Stage phase="reveal" />).container;
    });

    expect(
      skyLayerCount(container),
      "JuneSky never showed the reveal bloom — the reveal beat fired before its " +
        "subscription mounted and was dropped (same class as the finale-lightning bug).",
    ).toBe(REVEAL_LAYERS);
  });

  it("reacts across the live question→reveal SWAP (old JuneSky unmounts as the new one mounts and the beat fires)", async () => {
    let rerender!: (ui: ReactElement) => void;
    let container!: HTMLElement;
    await act(async () => {
      const r = render(<Stage phase="question" />);
      rerender = r.rerender;
      container = r.container;
    });

    // Baseline: at rest the water is calm — no reveal reaction yet.
    expect(skyLayerCount(container)).toBe(RESTING_LAYERS);

    await act(async () => {
      rerender(<Stage phase="reveal" />);
    });

    expect(
      skyLayerCount(container),
      "Across the TVQuestion→TVReveal swap, the new JuneSky never showed the " +
        "reveal bloom — the beat was consumed in the unmount/mount gap.",
    ).toBe(REVEAL_LAYERS);
  });
});

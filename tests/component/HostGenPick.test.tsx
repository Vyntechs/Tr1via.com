// Regression test for commit 32bb985 — clump-heavy pick distribution.
//
// The original bug: PickSidebar in HostGenPick.tsx keyed `byDiff[difficulty * 100]`,
// so when Claude rated all 7 picks at the same difficulty (common on tight
// topics) every pick overwrote the same slot — six of the seven board tiers
// rendered as empty in the sidebar while the host saw "7/7 picked." Brandon
// caught this with a real grunge-bands batch and screenshotted it.
//
// Fix landed in 32bb985: PickSidebar now keys by the server-mirroring
// `previewPointValues` result, which assigns 100..700 by sorted position
// regardless of input clumping. This test renders the full HostGenPick with
// pathological clump-difficulty input and asserts the visible sidebar.
//
// The pure-math regression for previewPointValues lives in
// tests/unit/difficulty.test.ts. THIS test guards the UI integration: if
// someone re-keys the sidebar back to raw difficulty, or if the helper stops
// being threaded through to PickSidebar, the rendered output drifts and this
// test fails.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  HostGenPick,
  type HostGenPickQuestion,
} from "@/components/host/gen/HostGenPick";

afterEach(() => cleanup());

function clumpQuestions(difficulty: number): HostGenPickQuestion[] {
  return Array.from({ length: 7 }, (_, i) => ({
    id: `q${i}`,
    prompt: `Question ${i}`,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    difficulty,
  }));
}

describe("HostGenPick sidebar — clump-heavy regression (32bb985)", () => {
  it("fills all 7 tiers when every pick has the same Claude difficulty", () => {
    const questions = clumpQuestions(3);
    const pickedIds = new Set(questions.map((q) => q.id));

    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={pickedIds}
      />,
    );

    // Each picked prompt appears once in its grid card and once in the
    // filled sidebar tier row. With the original bug only ONE sidebar slot
    // would render a prompt (since all picks share a key), so 6 of these
    // assertions would fail.
    for (let i = 0; i < 7; i++) {
      const matches = screen.getAllByText(`Question ${i}`);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }

    // The empty-slot placeholder ("open · pick a …") appears only in
    // unfilled sidebar tiers. With 7 picks no tier should be empty.
    expect(screen.queryAllByText(/open ·/i)).toHaveLength(0);
  });

  it("fills all 7 tiers even with extreme clump at difficulty 7 (max-hard input)", () => {
    const questions = clumpQuestions(7);
    const pickedIds = new Set(questions.map((q) => q.id));

    render(
      <HostGenPick
        themeKey="house"
        topic="Esoteric philosophy"
        questions={questions}
        pickedIds={pickedIds}
      />,
    );

    for (let i = 0; i < 7; i++) {
      const matches = screen.getAllByText(`Question ${i}`);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
    expect(screen.queryAllByText(/open ·/i)).toHaveLength(0);
  });

  it("shows 'open' placeholders only for unfilled tiers at partial picks", () => {
    const questions = clumpQuestions(3);
    // 3 picked → tiers 100, 200, 300 fill; 400/500/600/700 stay open.
    const pickedIds = new Set(["q0", "q1", "q2"]);

    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={pickedIds}
      />,
    );

    expect(screen.queryAllByText(/open ·/i)).toHaveLength(4);
  });

  it("annotates picks that shifted tier with their original difficulty struck through", () => {
    // Mixed clump: difficulty 3 across all 7 picks. Inherent tier for every
    // card is 300; preview-assigned tiers are 100..700. So six of the seven
    // picked cards should display the strikethrough indicator showing the
    // original 300 plus the new tier.
    const questions = clumpQuestions(3);
    const pickedIds = new Set(questions.map((q) => q.id));

    const { container } = render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={pickedIds}
      />,
    );

    // QuestionCard renders the original inherent value with a
    // line-through style only when the assigned tier differs. We can find
    // those by querying for strikethrough text equal to 300.
    const struck = Array.from(
      container.querySelectorAll<HTMLElement>("[style*='line-through']"),
    ).filter((el) => el.textContent?.trim() === "300");

    // Out of 7 picks at difficulty 3: 1 lands at 300 (no strikethrough),
    // 6 shift to other tiers (with strikethrough showing the original).
    expect(struck).toHaveLength(6);
  });

  it("renders the audit summary above the candidate grid when provided", () => {
    const questions = clumpQuestions(3);

    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        auditSummary={{
          acceptedCount: 7,
          generatedCount: 9,
          verifyPasses: 2,
          estimatedCostUsd: 0.12,
          imageTargetCount: 7,
          imageAttachedCount: 6,
          riskFlagCount: 1,
        }}
      />,
    );

    expect(screen.getByTestId("host-gen-audit-summary")).toBeInTheDocument();
    expect(screen.getByText("7 accepted from 9 candidates")).toBeInTheDocument();
  });
});

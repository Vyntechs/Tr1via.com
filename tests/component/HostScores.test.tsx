import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostScores } from "@/components/host/HostScores";
import type { GameScoreRow } from "@/lib/supabase/types";
import { readableForeground } from "@/lib/theme/contrast";
import { resolveTheme } from "@/lib/theme/resolve";
import { THEME_KEYS } from "@/lib/theme/tokens";

const scores: GameScoreRow[] = [
  { game_id: "g1", player_id: "p1", display_name: "Jordan", score: 6100, answered_count: 12, correct_count: 8, fastest_correct_ms: 1200 },
  { game_id: "g1", player_id: "p2", display_name: "Morgan", score: 5000, answered_count: 12, correct_count: 7, fastest_correct_ms: 1800 },
];

describe("HostScores", () => {
  it("searches proven score fields without inventing score movement", () => {
    render(<HostScores themeKey="march" gameNo={1} scores={scores} onSubmitAdjustment={vi.fn()} />);

    expect(screen.getByText("8 correct · 12 answered")).toBeVisible();
    expect(screen.queryByText(/\+1,100|score movement/i)).not.toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search players" });
    expect(search).toHaveStyle({ minHeight: "48px" });
    fireEvent.change(search, { target: { value: "morg" } });
    expect(screen.getByRole("button", { name: "Adjust points for Morgan" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Adjust points for Jordan" })).not.toBeInTheDocument();
  });

  it("reuses the audited adjustment reason flow and keeps modal controls at least 48px", () => {
    const onSubmitAdjustment = vi.fn();
    render(<HostScores themeKey="april" gameNo={1} scores={scores} onSubmitAdjustment={onSubmitAdjustment} />);

    const playerButton = screen.getByRole("button", { name: "Adjust points for Jordan" });
    expect(playerButton).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(playerButton);

    expect(screen.getByRole("dialog", { name: "Adjust points" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Adjust points" })).not.toHaveTextContent(/suspicious|sharing|cheating/i);
    expect(screen.queryByPlaceholderText(/suspicious|sharing|cheating/i)).not.toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close point adjustment" });
    expect(close).toHaveStyle({ minHeight: "48px", minWidth: "48px" });
    expect(screen.getByRole("combobox")).toHaveStyle({ minHeight: "48px" });
    expect(screen.getByRole("spinbutton")).toHaveStyle({ minHeight: "48px" });
    const reason = screen.getByPlaceholderText(/scoring fix/i);
    expect(reason).toHaveStyle({ minHeight: "48px" });
    const quickDelta = screen.getByRole("button", { name: "+300" });
    expect(quickDelta).toHaveStyle({ minHeight: "48px", minWidth: "48px" });
    fireEvent.click(quickDelta);
    fireEvent.change(reason, { target: { value: "Host-awarded bonus" } });
    const apply = screen.getByRole("button", { name: "Apply +300" });
    expect(apply).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(apply);

    expect(onSubmitAdjustment).toHaveBeenCalledWith("p1", 300, "Host-awarded bonus");
  });

  it.each(THEME_KEYS)("keeps the %s adjustment action readable", (themeKey) => {
    render(<HostScores themeKey={themeKey} gameNo={1} scores={scores} onSubmitAdjustment={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust points for Jordan" }));
    expect(screen.getByRole("button", { name: "Apply +100" })).toHaveStyle({
      color: readableForeground(resolveTheme(themeKey).accent),
    });
  });
});

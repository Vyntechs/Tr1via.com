import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("reuses the audited adjustment reason flow with accessible labels and contained focus", async () => {
    const onSubmitAdjustment = vi.fn().mockResolvedValue(undefined);
    render(<HostScores themeKey="april" gameNo={1} scores={scores} onSubmitAdjustment={onSubmitAdjustment} />);

    const playerButton = screen.getByRole("button", { name: "Adjust points for Jordan" });
    expect(playerButton).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(playerButton);

    expect(screen.getByRole("dialog", { name: "Adjust points" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Adjust points" })).not.toHaveTextContent(/suspicious|sharing|cheating/i);
    expect(screen.queryByPlaceholderText(/suspicious|sharing|cheating/i)).not.toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close point adjustment" });
    expect(close).toHaveStyle({ minHeight: "48px", minWidth: "48px" });
    const player = screen.getByRole("combobox", { name: "Player" });
    expect(player).toHaveStyle({ minHeight: "48px" });
    const delta = screen.getByRole("spinbutton", { name: "Delta (+/- points)" });
    expect(delta).toHaveStyle({ minHeight: "48px" });
    expect(delta).toHaveFocus();
    const reason = screen.getByPlaceholderText(/scoring fix/i);
    expect(reason).toHaveAccessibleName("Reason");
    expect(reason).toHaveStyle({ minHeight: "48px" });
    expect(document.querySelector(`label[for="${player.id}"]`)).toHaveTextContent("Player");
    expect(document.querySelector(`label[for="${delta.id}"]`)).toHaveTextContent("Delta (+/- points)");
    expect(document.querySelector(`label[for="${reason.id}"]`)).toHaveTextContent("Reason");
    const quickDelta = screen.getByRole("button", { name: "+300" });
    expect(quickDelta).toHaveStyle({ minHeight: "48px", minWidth: "48px" });
    fireEvent.click(quickDelta);
    fireEvent.change(reason, { target: { value: "Host-awarded bonus" } });
    const apply = screen.getByRole("button", { name: "Apply +300" });
    expect(apply).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(apply);

    expect(onSubmitAdjustment).toHaveBeenCalledWith("p1", 300, "Host-awarded bonus");
    expect(apply).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Adjust points" })).not.toBeInTheDocument());
  });

  it("traps focus, closes with Escape, and restores the invoking score row", () => {
    render(<HostScores themeKey="house" gameNo={1} scores={scores} onSubmitAdjustment={vi.fn()} />);
    const invoker = screen.getByRole("button", { name: "Adjust points for Jordan" });
    invoker.focus();
    fireEvent.click(invoker);
    const close = screen.getByRole("button", { name: "Close point adjustment" });
    const apply = screen.getByRole("button", { name: "Apply +100" });
    apply.focus();
    fireEvent.keyDown(apply, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(apply).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Adjust points" })).not.toBeInTheDocument();
    expect(invoker).toHaveFocus();
  });

  it("retains the form with an inline error and blocks duplicate async submissions", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const onSubmitAdjustment = vi.fn(() => pending);
    render(<HostScores themeKey="house" gameNo={1} scores={scores} onSubmitAdjustment={onSubmitAdjustment} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust points for Jordan" }));
    const reason = screen.getByRole("textbox", { name: "Reason" });
    fireEvent.change(reason, { target: { value: "Manual correction" } });
    const apply = screen.getByRole("button", { name: "Apply +100" });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(onSubmitAdjustment).toHaveBeenCalledTimes(1);
    expect(apply).toBeDisabled();

    reject(new Error("Connection interrupted"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByRole("textbox", { name: "Reason" })).toHaveValue("Manual correction");
    expect(screen.getByRole("button", { name: "Apply +100" })).toBeEnabled();
  });

  it.each(THEME_KEYS)("keeps the %s adjustment action readable", (themeKey) => {
    render(<HostScores themeKey={themeKey} gameNo={1} scores={scores} onSubmitAdjustment={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust points for Jordan" }));
    expect(screen.getByRole("button", { name: "Apply +100" })).toHaveStyle({
      color: readableForeground(resolveTheme(themeKey).accent),
    });
  });
});

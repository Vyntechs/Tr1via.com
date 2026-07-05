import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerRecap } from "@/components/player/PlayerRecap";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderRecap(onSuggestTopic = vi.fn()) {
  return render(
    <ThemeProvider themeKey="july">
      <PlayerRecap onSuggestTopic={onSuggestTopic} />
    </ThemeProvider>,
  );
}

describe("PlayerRecap topic suggestion composer", () => {
  it("submits the trimmed topic text", async () => {
    const onSuggestTopic = vi.fn().mockResolvedValue(undefined);
    renderRecap(onSuggestTopic);
    fireEvent.change(screen.getByLabelText(/topic for next week/i), {
      target: { value: "  2000s pop songs  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save idea/i }));
    await waitFor(() => expect(onSuggestTopic).toHaveBeenCalledWith("2000s pop songs"));
    expect(await screen.findByText(/saved for next week/i)).toBeInTheDocument();
  });

  it("does not submit blank text", () => {
    const onSuggestTopic = vi.fn();
    renderRecap(onSuggestTopic);
    expect(screen.getByRole("button", { name: /save idea/i })).toBeDisabled();
    expect(onSuggestTopic).not.toHaveBeenCalled();
  });

  it("shows a retryable error when saving fails", async () => {
    const onSuggestTopic = vi.fn().mockRejectedValue(new Error("network"));
    renderRecap(onSuggestTopic);
    fireEvent.change(screen.getByLabelText(/topic for next week/i), {
      target: { value: "Local legends" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save idea/i }));
    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
  });
});

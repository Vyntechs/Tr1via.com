// Player-side PalettePeek overlay — the egg that the 5-tap wordmark
// reveals. Shows all 14 themed palettes; tapping one switches the live
// theme; closes via Esc, backdrop, or the X button.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { PalettePeek } from "@/components/player/PalettePeek";
import { ThemeProvider } from "@/components/system/ThemeProvider";

function renderPeek(open: boolean, onClose = vi.fn()) {
  const utils = render(
    <ThemeProvider themeKey="house">
      <PalettePeek open={open} onClose={onClose} />
    </ThemeProvider>,
  );
  return { ...utils, onClose };
}

describe("PalettePeek", () => {
  beforeEach(() => {
    document.documentElement.setAttribute("data-theme", "house");
  });
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when closed", () => {
    const { container } = renderPeek(false);
    expect(container.textContent).toBe("");
  });

  it("renders all 14 themed palette names when open", () => {
    renderPeek(true);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/House · Pub Night/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Daylight/)).toBeInTheDocument();
    expect(within(dialog).getByText(/January · Ice/)).toBeInTheDocument();
    expect(within(dialog).getByText(/December · Christmas/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: /palette/i })).toHaveLength(14);
  });

  it("switches the document theme attribute when a palette is picked", () => {
    renderPeek(true);
    const card = screen.getByRole("button", { name: /February · Valentine palette/i });
    fireEvent.click(card);
    expect(document.documentElement.getAttribute("data-theme")).toBe("february");
  });

  it("calls onClose when the Escape key is pressed", () => {
    const { onClose } = renderPeek(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const { onClose } = renderPeek(true);
    fireEvent.click(screen.getByTestId("palette-peek-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is pressed", () => {
    const { onClose } = renderPeek(true);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the 'Made it!' toast briefly after a pick", () => {
    vi.useFakeTimers();
    renderPeek(true);
    fireEvent.click(screen.getByRole("button", { name: /march · st. patrick palette/i }));
    expect(screen.getByText(/made it/i)).toBeInTheDocument();
    vi.runAllTimers();
    vi.useRealTimers();
  });
});

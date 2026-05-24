// Shared PalettePeek overlay — the picker used by the host setup screen
// to choose the night's palette. Shows all 14 themed palettes; tapping one
// fires onPick(key); closes via Esc, backdrop, or the X button.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { PalettePeek } from "@/components/shared/PalettePeek";
import { ThemeProvider } from "@/components/system/ThemeProvider";

function renderPeek(open: boolean, onClose = vi.fn(), onPick = vi.fn()) {
  const utils = render(
    <ThemeProvider themeKey="house">
      <PalettePeek
        open={open}
        onClose={onClose}
        onPick={onPick}
        activeThemeKey="house"
      />
    </ThemeProvider>,
  );
  return { ...utils, onClose, onPick };
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

  it("fires onPick with the chosen theme key when a palette card is tapped", () => {
    const { onPick } = renderPeek(true);
    const card = screen.getByRole("button", { name: /February · Valentine palette/i });
    fireEvent.click(card);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("february");
  });

  it("marks the activeThemeKey card with aria-pressed", () => {
    renderPeek(true);
    const houseCard = screen.getByRole("button", { name: /House · Pub Night palette/i });
    expect(houseCard.getAttribute("aria-pressed")).toBe("true");
    const otherCard = screen.getByRole("button", { name: /February · Valentine palette/i });
    expect(otherCard.getAttribute("aria-pressed")).toBe("false");
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

  it("shows a transient confirmation toast after a pick", () => {
    vi.useFakeTimers();
    renderPeek(true);
    fireEvent.click(screen.getByRole("button", { name: /march · st. patrick palette/i }));
    expect(screen.getByText(/locked in/i)).toBeInTheDocument();
    vi.runAllTimers();
    vi.useRealTimers();
  });
});

// EmptyState renders a friendly "nothing here yet" panel. Themed via the
// design system; used inside loading.tsx / not-found.tsx surfaces and any
// inline list whose data set is empty.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmptyState } from "@/components/system/EmptyState";
import { ThemeProvider } from "@/components/system/ThemeProvider";

function renderInTheme(node: React.ReactNode) {
  return render(<ThemeProvider themeKey="house">{node}</ThemeProvider>);
}

describe("EmptyState", () => {
  afterEach(() => cleanup());
  it("renders the title as an accessible heading", () => {
    renderInTheme(<EmptyState title="Nothing here yet." />);
    const heading = screen.getByRole("heading", { name: /nothing here yet/i });
    expect(heading).toBeInTheDocument();
  });

  it("renders an optional description", () => {
    renderInTheme(
      <EmptyState
        title="No suggestions yet."
        description="Players will pitch topics here once the room opens."
      />,
    );
    expect(
      screen.getByText(/players will pitch topics/i),
    ).toBeInTheDocument();
  });

  it("renders an optional action child", () => {
    renderInTheme(
      <EmptyState
        title="No nights yet."
        action={<button type="button">Plan your first night</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /plan your first night/i }),
    ).toBeInTheDocument();
  });

  it("does not render description or action when omitted", () => {
    renderInTheme(<EmptyState title="Quiet in here." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Heading present, but no extra paragraph siblings.
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });
});

// HostGenError — failure UI when Claude generation didn't finish.
// Two primary actions: Try again + Enter manually. Also a Back to setup
// button when the parent provides onBack.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HostGenError } from "@/components/host/gen/HostGenError";

afterEach(() => cleanup());

describe("HostGenError", () => {
  it("surfaces the friendly headline and the supplied message", () => {
    render(
      <HostGenError
        themeKey="house"
        topic="Pixar Movies"
        shellTitle="failed · pixar movies"
        message="Anthropic is busy — try again in a moment."
      />,
    );
    expect(
      screen.getByText(/generation didn.t work/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/anthropic is busy/i),
    ).toBeInTheDocument();
  });

  it("falls back to a generic message when none is provided", () => {
    render(
      <HostGenError themeKey="house" shellTitle="failed · pixar movies" />,
    );
    expect(
      screen.getByText(/something went sideways/i),
    ).toBeInTheDocument();
  });

  it("invokes onRetry when 'Try again' is clicked", () => {
    const onRetry = vi.fn();
    render(<HostGenError themeKey="house" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("invokes onEnterManually when 'Enter manually' is clicked", () => {
    const onEnter = vi.fn();
    render(
      <HostGenError themeKey="house" onEnterManually={onEnter} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /enter manually/i }),
    );
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("disables 'Try again' while a retry is in flight", () => {
    render(<HostGenError themeKey="house" isRetrying />);
    const button = screen.getByRole("button", { name: /trying/i });
    expect(button).toBeDisabled();
  });

  it("renders an optional 'Back to setup' button only when onBack is given", () => {
    const { rerender } = render(<HostGenError themeKey="house" />);
    expect(
      screen.queryByRole("button", { name: /back to setup/i }),
    ).not.toBeInTheDocument();
    rerender(<HostGenError themeKey="house" onBack={() => {}} />);
    expect(
      screen.getByRole("button", { name: /back to setup/i }),
    ).toBeInTheDocument();
  });

  it("renders as an assertive alert region for screen readers", () => {
    render(<HostGenError themeKey="house" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });
});

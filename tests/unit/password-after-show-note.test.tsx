// components/host/PasswordAfterShowNote — the note she sees when the
// password step skipped itself because a show is running.
//
// Proves: with ?pw=after-show it says "you can create a password after the
// show", drops the flag from the address bar, and goes away on "OK" or by
// itself; without the flag, or on an in-show page, it shows nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", pathname: "/host" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => nav.pathname,
}));

import { PASSWORD_AFTER_SHOW_NOTE, PasswordAfterShowNote } from "@/components/host/PasswordAfterShowNote";
import { ThemeProvider } from "@/components/system";

function show(pathname: string, search: string) {
  nav.pathname = pathname;
  nav.search = search;
  window.history.replaceState(null, "", `${pathname}${search ? `?${search}` : ""}`);
  render(
    <ThemeProvider themeKey="house">
      <PasswordAfterShowNote />
    </ThemeProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PasswordAfterShowNote", () => {
  it("says why the password step was skipped, and cleans the address bar", () => {
    show("/host/setup/n1", "slot=2&pw=after-show");
    expect(screen.getByTestId("password-after-show-note")).toHaveTextContent(PASSWORD_AFTER_SHOW_NOTE);
    expect(PASSWORD_AFTER_SHOW_NOTE).toBe("Your show is running — you can create a password after the show.");
    expect(window.location.pathname + window.location.search).toBe("/host/setup/n1?slot=2");
  });

  it("'OK' closes it", () => {
    show("/host", "pw=after-show");
    fireEvent.click(screen.getByTestId("password-after-show-ok"));
    expect(screen.queryByTestId("password-after-show-note")).toBeNull();
  });

  it("goes away by itself after a few seconds", () => {
    show("/host", "pw=after-show");
    expect(screen.getByTestId("password-after-show-note")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId("password-after-show-note")).toBeNull();
  });

  it("nothing without the flag", () => {
    show("/host", "");
    expect(screen.queryByTestId("password-after-show-note")).toBeNull();
  });

  it("never on the in-show pages", () => {
    show("/host/live/n1", "pw=after-show");
    expect(screen.queryByTestId("password-after-show-note")).toBeNull();
  });
});

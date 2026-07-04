// ConnectionRibbon — thin top-of-screen network status bar on the player
// surface. The new "unreachable" tier surfaces the switch-to-hotspot message
// distinct from the transient "Reconnecting…" / "You're offline" tiers.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { ConnectionRibbon } from "@/components/player/ConnectionRibbon";
import { TID } from "../e2e/helpers/selectors";

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

afterEach(() => cleanup());

describe("ConnectionRibbon", () => {
  it("renders nothing on the happy path", () => {
    render(wrap(<ConnectionRibbon status="online" />));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the hotspot guidance on the 'unreachable' tier", () => {
    render(wrap(<ConnectionRibbon status="unreachable" />));
    const ribbon = screen.getByRole("status");
    expect(ribbon).toHaveTextContent(/can't reach the server/i);
    expect(ribbon).toHaveTextContent(/hotspot/i);
  });

  it("tags the unreachable ribbon with its data-testid", () => {
    render(wrap(<ConnectionRibbon status="unreachable" />));
    expect(screen.getByTestId(TID.connection.ribbon)).toBeInTheDocument();
  });

  it("frames backup mode as a calm catch-up state", () => {
    render(wrap(<ConnectionRibbon status="backup" />));
    const ribbon = screen.getByRole("status");
    expect(ribbon).toHaveTextContent(/catching up/i);
    expect(ribbon).toHaveTextContent(/game is still live/i);
    expect(ribbon).toHaveTextContent(/keep playing/i);
    expect(ribbon).not.toHaveTextContent(/slow/i);
    expect(ribbon).not.toHaveTextContent(/backup connection/i);
  });

  it("keeps the unreachable message distinct from 'reconnecting'", () => {
    render(wrap(<ConnectionRibbon status="reconnecting" />));
    const ribbon = screen.getByRole("status");
    expect(ribbon).toHaveTextContent(/reconnecting/i);
    expect(ribbon).not.toHaveTextContent(/hotspot/i);
  });
});

// tests/unit/HostConnectionBanner.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostConnectionBanner } from "@/components/host/HostConnectionBanner";
import { setChannelHealth, __resetChannelHealthForTests } from "@/lib/realtime/channelHealth";
import { setReachability, __resetReachabilityForTests } from "@/lib/realtime/reachability";

afterEach(() => {
  cleanup();
  __resetChannelHealthForTests();
  __resetReachabilityForTests();
});

describe("HostConnectionBanner", () => {
  it("renders nothing when healthy", () => {
    setChannelHealth("SUBSCRIBED");
    render(<HostConnectionBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the reconnecting message when the channel is unhealthy", () => {
    setChannelHealth("CHANNEL_ERROR");
    render(<HostConnectionBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/reconnecting/i);
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "shows the banner when channel health is %s",
    (state) => {
      setChannelHealth(state);
      render(<HostConnectionBanner />);
      expect(screen.getByRole("status")).toHaveTextContent(/reconnecting/i);
    },
  );

  it("shows the switch-to-hotspot message when the server is unreachable", () => {
    setReachability("unreachable");
    render(<HostConnectionBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/can't reach the server/i);
    expect(banner).toHaveTextContent(/hotspot/i);
  });

  it("prefers the unreachable message over 'reconnecting' when reads also fail", () => {
    setChannelHealth("CHANNEL_ERROR");
    setReachability("unreachable");
    render(<HostConnectionBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/hotspot/i);
  });

  it("clears the banner once reachability recovers to ok", () => {
    setReachability("ok");
    render(<HostConnectionBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

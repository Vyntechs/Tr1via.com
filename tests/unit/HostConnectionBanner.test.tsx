// tests/unit/HostConnectionBanner.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostConnectionBanner } from "@/components/host/HostConnectionBanner";
import { setChannelHealth, __resetChannelHealthForTests } from "@/lib/realtime/channelHealth";

afterEach(() => {
  cleanup();
  __resetChannelHealthForTests();
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
});

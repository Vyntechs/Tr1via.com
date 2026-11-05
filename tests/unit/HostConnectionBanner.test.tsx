// tests/unit/HostConnectionBanner.test.tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
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

  describe("with a room already on screen", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    it("stays amber for 45s, then gives the hotspot message", async () => {
      vi.useFakeTimers();
      setReachability("unreachable");
      render(<HostConnectionBanner hasRoomView />);

      await advance(44_999);
      expect(screen.getByRole("status")).toHaveTextContent("Slow connection. Game still live.");
      expect(screen.queryByTestId("host-unreachable-banner")).toBeNull();

      await advance(1);
      expect(screen.getByTestId("host-unreachable-banner")).toHaveTextContent(/hotspot/i);
    });

    it("amber also beats 'reconnecting' during those 45s", async () => {
      vi.useFakeTimers();
      setChannelHealth("CHANNEL_ERROR");
      setReachability("unreachable");
      render(<HostConnectionBanner hasRoomView />);

      await advance(0);

      expect(screen.getByRole("status")).toHaveTextContent("Slow connection. Game still live.");
    });

    it("a recovery inside the 45s clears it and starts the next spell from zero", async () => {
      vi.useFakeTimers();
      setReachability("unreachable");
      render(<HostConnectionBanner hasRoomView />);
      await advance(40_000);

      act(() => setReachability("ok"));
      expect(screen.queryByRole("status")).toBeNull();

      act(() => setReachability("unreachable"));
      await advance(40_000);
      expect(screen.queryByTestId("host-unreachable-banner")).toBeNull();
    });

    it("with no room to show, the hotspot message comes straight away", () => {
      setReachability("unreachable");
      render(<HostConnectionBanner hasRoomView={false} />);

      expect(screen.getByTestId("host-unreachable-banner")).toBeInTheDocument();
    });
  });
});

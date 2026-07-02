import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TVRoomMagicOverlay } from "@/components/tv/TVRoomMagicOverlay";
import type { RoomMagicReactionEvent } from "@/lib/room-magic/reactions";

function reaction(
  kind: RoomMagicReactionEvent["kind"],
  playerId: string,
  serverNow = new Date(Date.now()).toISOString(),
): RoomMagicReactionEvent {
  return {
    kind,
    questionId: "question-1",
    playerId,
    serverNow,
  };
}

describe("TVRoomMagicOverlay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when disabled", () => {
    const { container } = render(
      <TVRoomMagicOverlay enabled={false} event={reaction("wow", "player-1")} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a null event", () => {
    const { container } = render(
      <TVRoomMagicOverlay enabled event={null} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders aggregate July effects without printing reaction words", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T18:00:00.000Z"));

    const { rerender } = render(
      <TVRoomMagicOverlay enabled event={reaction("wow", "player-1")} themeKey="july" />,
    );

    rerender(
      <TVRoomMagicOverlay
        enabled
        event={reaction("wow", "player-2", "2026-06-30T18:00:00.500Z")}
        themeKey="july"
      />,
    );

    const overlay = screen.getByTestId("tv-room-magic-overlay");
    expect(overlay).toHaveAttribute("data-reaction-skin", "july-reaction-glyph");
    expect(screen.queryByTestId("tv-room-magic-pill-wow")).not.toBeInTheDocument();
    const effect = screen.getByTestId("tv-room-magic-july-effect-wow");
    expect(effect).toHaveAttribute("data-reaction-count", "2");
    expect(effect).not.toHaveTextContent(/wow/i);
    expect(overlay).not.toHaveTextContent(/wow|nice|bravo|close/i);
  });

  it("renders a neutral fallback skin for themes without custom reaction art", () => {
    render(
      <TVRoomMagicOverlay
        enabled
        event={reaction("nice_one", "player-1")}
        themeKey="august"
      />,
    );

    const overlay = screen.getByTestId("tv-room-magic-overlay");
    expect(overlay).toHaveAttribute("data-reaction-skin", "default");
    expect(screen.getByTestId("tv-room-magic-default-nice_one")).toHaveTextContent("Nice one");
  });

  it("renders replayed durable events when the live broadcast was missed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T18:00:05.000Z"));

    render(
      <TVRoomMagicOverlay
        enabled
        event={null}
        events={[
          reaction("wow", "player-1", "2026-06-30T18:00:01.000Z"),
          reaction("nice_one", "player-2", "2026-06-30T18:00:02.000Z"),
        ]}
        themeKey="may"
      />,
    );

    expect(screen.getByTestId("tv-room-magic-default-wow")).toHaveTextContent("Wow");
    expect(screen.getByTestId("tv-room-magic-default-nice_one")).toHaveTextContent("Nice one");
  });

  it("removes events after the short display window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T18:00:00.000Z"));

    render(<TVRoomMagicOverlay enabled event={reaction("nice_one", "player-1")} />);

    expect(screen.getByTestId("tv-room-magic-overlay")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_700);
    });

    expect(screen.queryByTestId("tv-room-magic-overlay")).not.toBeInTheDocument();
  });

  it("does not use sound or audio language", () => {
    render(<TVRoomMagicOverlay enabled event={reaction("applause", "player-1")} themeKey="july" />);

    const overlay = screen.getByTestId("tv-room-magic-overlay");
    expect(
      within(overlay).queryByText(/sound|audio|speaker|music|volume|chime/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the decorative layer out of pointer hit testing", () => {
    render(<TVRoomMagicOverlay enabled event={reaction("brutal", "player-1")} themeKey="july" />);

    const overlay = screen.getByTestId("tv-room-magic-overlay");
    expect(overlay.style.pointerEvents).toBe("none");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
  });

  it("ignores malformed or stale events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T18:00:00.000Z"));

    const stale = reaction("wow", "player-1", "2026-06-30T17:59:20.000Z");
    const { container, rerender } = render(
      <TVRoomMagicOverlay enabled event={stale} />,
    );

    expect(container.firstChild).toBeNull();

    rerender(
      <TVRoomMagicOverlay
        enabled
        event={
          {
            ...reaction("wow", "player-2"),
            kind: "chat",
          } as unknown as RoomMagicReactionEvent
        }
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

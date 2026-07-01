import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { RoomMagicReactionControls } from "@/components/player/RoomMagicReactionControls";
import { ROOM_MAGIC_REACTION_LABELS } from "@/lib/room-magic/reactions";

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";

function renderControls(enabled = true) {
  return render(
    <ThemeProvider themeKey="june">
      <RoomMagicReactionControls questionId={QUESTION_ID} enabled={enabled} />
    </ThemeProvider>,
  );
}

describe("RoomMagicReactionControls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the four approved bounded reaction labels", () => {
    renderControls();

    for (const label of Object.values(ROOM_MAGIC_REACTION_LABELS)) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("renders nothing when Room Magic is disabled", () => {
    const { container } = renderControls(false);
    expect(container.firstChild).toBeNull();
  });

  it("posts the selected reaction and locks the controls after a successful tap", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ accepted: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Wow" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/room-magic/reactions",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: QUESTION_ID, kind: "wow" }),
      }),
    );
    expect(await screen.findByText("Sent to the room")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("keeps duplicate responses in the sent state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ accepted: false, reason: "already_sent" }),
      })),
    );
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Applause" }));

    expect(await screen.findByText("Sent to the room")).toBeInTheDocument();
  });

  it("settles quietly when the post fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Nice" }));

    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    expect(screen.queryByText(/error|problem|try again|failed/i)).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("keeps the approved concise player affordance labels", () => {
    renderControls();

    expect(screen.getByRole("button", { name: "Wow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Applause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nice one" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close one" })).not.toBeInTheDocument();
  });
});

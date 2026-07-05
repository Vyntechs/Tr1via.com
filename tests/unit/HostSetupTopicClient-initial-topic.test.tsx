import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostSetupTopicClient } from "@/app/host/setup/[nightId]/topic/HostSetupTopicClient";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HostSetupTopicClient initialTopic", () => {
  it("prefills and submits a player idea through the existing category flow", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ category: { id: "cat-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostSetupTopicClient
        nightId="night-1"
        gameId="game-1"
        gameNo={1}
        position={2}
        themeKey="july"
        initialTopic="Pixar movies"
      />,
    );

    expect(screen.getByDisplayValue("Pixar movies")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pull 20 questions/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/categories",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            gameId: "game-1",
            name: "Pixar movies",
            topic: "Pixar movies",
            position: 2,
          }),
        }),
      );
    });
    expect(push).toHaveBeenCalledWith("/host/setup/night-1/pick/cat-1");
  });
});

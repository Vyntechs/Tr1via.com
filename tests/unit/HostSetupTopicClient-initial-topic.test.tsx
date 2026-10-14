import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostSetupTopicClient } from "@/app/host/setup/[nightId]/topic/HostSetupTopicClient";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
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
    // replace, not push: Back from the pick screen must not land on a blank
    // topic form for a slot that is now filled.
    expect(replace).toHaveBeenCalledWith("/host/setup/night-1/pick/cat-1");
    expect(push).not.toHaveBeenCalled();
  });

  it("re-typing the same topic for a filled slot reuses that category and keeps going", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            category: { id: "cat-ghost", name: "Legendary Ghost stories" },
            reused: true,
            sameTopic: true,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostSetupTopicClient
        nightId="night-1"
        gameId="game-2"
        gameNo={2}
        position={2}
        themeKey="july"
        initialTopic="legendary ghost stories"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pull 20 questions/i }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/host/setup/night-1/pick/cat-ghost");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-typing the same topic for a locked slot opens it without starting generation again", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          category: { id: "cat-ghost", name: "Ghost Stories", state: "ready" },
          reused: true,
          sameTopic: true,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostSetupTopicClient
        nightId="night-1"
        gameId="game-2"
        gameNo={2}
        position={2}
        themeKey="july"
        initialTopic="Legendary Ghost Stories"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pull 20 questions/i }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/host/setup/night-1/pick/cat-ghost");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a different topic aimed at a filled slot says the slot is taken and starts nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          category: { id: "cat-saint", name: "Saint or Sitcom Character?" },
          reused: true,
          sameTopic: false,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostSetupTopicClient
        nightId="night-1"
        gameId="game-1"
        gameNo={1}
        position={6}
        themeKey="july"
        initialTopic="Is That Actually Catholic?"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pull 20 questions/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Slot 6 already has");
    expect(alert.textContent).toContain("Saint or Sitcom Character?");
    // No generation for the old category, no navigation.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

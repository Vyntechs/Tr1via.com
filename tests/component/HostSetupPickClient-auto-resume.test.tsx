import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { GenerationStatus } from "@/lib/hooks/useGenerationStatus";

const status = vi.hoisted(() =>
  ({
    current: {
      kind: "needs-attention",
      progress: {
        phase: "needs_attention",
        targetCount: 20,
        writtenCount: 19,
        certifiedCount: 19,
        imageCount: 19,
        remainingCount: 1,
        attempt: 2,
        statusLine: "1 question choice still needs checking.",
        ready: false,
      },
    },
  }) as { current: GenerationStatus },
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/useGenerationStatus", () => ({
  GENERATION_STALL_TIMEOUT_MS: 330_000,
  useGenerationStatus: () => status.current,
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: vi.fn(),
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

import { HostSetupPickClient } from "@/app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  status.current = {
    kind: "needs-attention",
    progress: {
      phase: "needs_attention",
      targetCount: 20,
      writtenCount: 19,
      certifiedCount: 19,
      imageCount: 19,
      remainingCount: 1,
      attempt: 2,
      statusLine: "1 question choice still needs checking.",
      ready: false,
    },
  };
});

describe("HostSetupPickClient automatic generation recovery", () => {
  it("keeps loading visible and resumes only once for a durable eligible attempt", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostSetupPickClient
        nightId="night-1"
        categoryId="category-1"
        categoryName="Space"
        categoryTopic="space"
        initialState="generating"
        initialQuestions={[]}
        themeKey="house"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("host-gen-loading-layout")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves attempt three on the Continue recovery screen", async () => {
    status.current = {
      kind: "needs-attention",
      progress: {
        phase: "needs_attention",
        targetCount: 20,
        writtenCount: 0,
        certifiedCount: 0,
        imageCount: 0,
        remainingCount: 20,
        attempt: 3,
        statusLine: "Generation needs attention.",
        ready: false,
      },
    };

    render(
      <HostSetupPickClient
        nightId="night-1"
        categoryId="category-1"
        categoryName="Space"
        categoryTopic="space"
        initialState="generating"
        initialQuestions={[]}
        themeKey="house"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });
});

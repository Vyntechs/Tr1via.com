// A host saw "Generation paused" for ~4 minutes while the build was healthy.
//
// Oct 14 2026, topic "movies from 2026": attempt 1 ended with too few certified
// questions, the page restarted the job on its own 8 seconds later (attempt 2,
// fresh heartbeat), but attempt 1's error text stayed in page memory, so the
// paused screen sat on top of a live build until it finished.
//
// These tests drive the real pick screen and the real status hook with a fake
// network (fake database reads, fake live channel, fake generate route).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type Handler = (msg: { payload: unknown }) => unknown;

const world = vi.hoisted(() => ({
  categoryState: "generating",
  job: null as null | Record<string, unknown>,
  questions: [] as unknown[],
  handlers: {} as Record<string, (msg: { payload: unknown }) => unknown>,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    channel: () => {
      const channel = {
        on: (_type: string, filter: { event: string }, cb: Handler) => {
          world.handlers[filter.event] = cb;
          return channel;
        },
        subscribe: vi.fn(),
      };
      return channel;
    },
    removeChannel: vi.fn(),
    from: (table: string) => {
      const read = () => {
        if (table === "categories") {
          return { data: { state: world.categoryState }, error: null };
        }
        if (table === "question_generation_jobs") {
          return { data: world.job, error: null };
        }
        if (table === "questions") return { data: world.questions, error: null };
        return { data: null, error: null };
      };
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(read()).then(res, rej),
      };
      for (const m of ["select", "eq", "in", "order", "limit", "single"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = () => Promise.resolve(read());
      return chain;
    },
  }),
}));

import { HostSetupPickClient } from "@/app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient";

const PAUSED_TEXT = "The question builder paused before it finished.";

function jobRow(over: Record<string, unknown>, heartbeatAgeMs = 1_000) {
  return {
    id: "job-1",
    category_id: "category-1",
    game_id: "g",
    night_id: "night-1",
    host_id: "h",
    phase: "writing",
    target_count: 20,
    written_count: 12,
    certified_count: 5,
    image_count: 0,
    attempt: 1,
    last_error: null,
    heartbeat_at: new Date(Date.now() - heartbeatAgeMs).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function questionRow(n: number) {
  return {
    id: `q${n}`,
    category_id: "category-1",
    point_value: null,
    prompt: `Question number ${n}?`,
    options: ["One", "Two", "Three", "Four"],
    correct_index: 0,
    image_url: null,
    image_attribution: null,
    image_source: null,
    difficulty: 2,
    source: "ai",
    is_picked: false,
    fact_blurb: null,
    played_at: null,
    finished_at: null,
    photo_query: null,
  };
}

function renderScreen() {
  return render(
    <HostSetupPickClient
      nightId="night-1"
      categoryId="category-1"
      categoryName="Movies from 2026"
      categoryTopic="movies from 2026"
      initialState="generating"
      initialQuestions={[]}
      themeKey="house"
    />,
  );
}

/** Let the 5-second poll (and everything it triggers) run. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function pollOnce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_100);
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();
  });
}

async function flush() {
  // A few short rounds: poll -> state change -> queued effect -> next render.
  for (let round = 0; round < 3; round++) {
    await act(async () => {
      await settle();
      await vi.advanceTimersByTimeAsync(50);
      await settle();
    });
  }
}

const pausedShown = () => screen.queryAllByText(/generation paused/i).length > 0;

beforeEach(() => {
  vi.useFakeTimers();
  world.categoryState = "generating";
  world.job = null;
  world.questions = [];
  world.handlers = {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("pick screen: paused screen only for a build that is really stopped", () => {
  it("(a) attempt 1 fails, the server restarts it as attempt 2: no paused screen, calm text, then the pick list", async () => {
    // The restart request is slow, so attempt 1's error broadcast lands while
    // it is still in flight (the order the host hit).
    let answerRestart: (r: Response) => void = () => {};
    const restart = new Promise<Response>((resolve) => {
      answerRestart = resolve;
    });
    const fetchMock = vi.fn(() => restart);
    vi.stubGlobal("fetch", fetchMock);

    world.job = jobRow({
      attempt: 1,
      phase: "needs_attention",
      last_error: PAUSED_TEXT,
    });
    renderScreen();
    await flush();
    // First poll: failed attempt 1 -> the page restarts the job by itself.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Attempt 1's error broadcast arrives: the stuck message gets stored.
    await act(async () => {
      await world.handlers["error"]({ payload: { attempt: 1, error: PAUSED_TEXT } });
    });
    expect(pausedShown()).toBe(true); // sanity: this is the screen the host saw

    // The server starts attempt 2 and answers the restart request.
    world.job = jobRow({ attempt: 2, phase: "writing", certified_count: 5 });
    await act(async () => {
      answerRestart(
        new Response(JSON.stringify({ attempt: 2 }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    await pollOnce();

    expect(pausedShown()).toBe(false);
    expect(screen.queryByText(/question builder paused/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("host-gen-loading-layout")).toBeInTheDocument();

    // Still healthy a few polls later (fresh heartbeat each time).
    world.job = jobRow({ attempt: 2, phase: "checking", certified_count: 6 });
    await pollOnce();
    expect(pausedShown()).toBe(false);

    // Attempt 2 finishes: the page flips to the pick list on its own.
    world.job = jobRow({ attempt: 2, phase: "ready", certified_count: 7, image_count: 7 });
    world.categoryState = "review";
    world.questions = Array.from({ length: 7 }, (_, i) => questionRow(i + 1));
    await pollOnce();
    await flush();

    expect(screen.getByTestId("host-gen-pick-layout")).toBeInTheDocument();
    expect(pausedShown()).toBe(false);
  });

  it("(b) a job that really stopped (no heartbeat for minutes) shows the paused screen", async () => {
    vi.stubGlobal("fetch", vi.fn());
    // Attempt 3 has no automatic restart left; heartbeat is 6 minutes old.
    world.job = jobRow(
      { attempt: 3, phase: "writing", certified_count: 5 },
      6 * 60_000,
    );
    renderScreen();
    await flush();
    await flush();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(pausedShown()).toBe(true);
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter manually|type|by hand/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to setup/i })).toBeInTheDocument();
  });

  it("(c) attempt 1 failed and nothing newer started: the paused screen still shows", async () => {
    // The automatic restart is refused, so there is no newer attempt.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Could not restart." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    world.job = jobRow({ attempt: 1, phase: "needs_attention", last_error: PAUSED_TEXT });
    renderScreen();
    await flush();
    await pollOnce();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(pausedShown()).toBe(true);
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });
});

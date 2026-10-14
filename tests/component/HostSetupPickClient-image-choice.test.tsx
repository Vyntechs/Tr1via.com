// The photo choice must offer the library's photos on every way in.
//
// Bug (reported Oct 14 2026 by a host): opening a question with Edit and
// tapping "Swap image →" showed "From the library · 0 fresh", an empty
// grid and only "Upload your own". That path saved the edit and switched
// screens but never asked for the library photos. Until Oct 1 a "Show
// twelve more" tile on that screen loaded them; when it was removed (it
// repeated the same search on the card path) the Edit path lost the
// library completely. These tests drive the real pick screen with a fake
// network.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/useGenerationStatus", () => ({
  GENERATION_STALL_TIMEOUT_MS: 330_000,
  useGenerationStatus: () => ({ kind: "ok" }),
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
    // Every table read comes back empty: the screen keeps the rows it was
    // given, which is all these tests need.
    from: () => {
      const result = Promise.resolve({ data: null, error: null });
      const chain: Record<string, unknown> = {
        then: result.then.bind(result),
      };
      for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle", "single"]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  }),
}));

import { HostSetupPickClient } from "@/app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient";

type Row = Parameters<typeof HostSetupPickClient>[0]["initialQuestions"][number];

function row(id: string, prompt: string): Row {
  return {
    id,
    category_id: "category-1",
    point_value: null,
    prompt,
    options: ["One", "Two", "Three", "Four"],
    correct_index: 0,
    image_url: `https://images.pexels.com/photos/${id}/current.jpeg`,
    image_attribution: "Someone",
    image_source: "pexels",
    difficulty: 2,
    source: "ai",
    is_picked: false,
    fact_blurb: null,
    played_at: null,
    finished_at: null,
    photo_query: null,
  } as Row;
}

const Q1 = row("q1", "Which saint is the patron of animals?");
const Q2 = row("q2", "Which city is home to the Vatican?");

function photosFor(id: string) {
  return {
    query: id,
    photos: [1, 2, 3].map((n) => ({
      id: Number(`${id === "q1" ? 1 : 2}00${n}`),
      src: { large: `https://images.pexels.com/photos/${id}-alt-${n}.jpeg` },
      photographer: `Photographer ${n}`,
    })),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fake network: PATCH saves echo the row back; GET /photos returns that
 *  question's own library photos (optionally held until released). */
function installFetch(opts: { holdPhotos?: boolean } = {}) {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const photos = url.match(/\/api\/questions\/([^/]+)\/photos$/);
    if (photos && method === "GET") {
      if (opts.holdPhotos) await gate;
      return json(photosFor(photos[1]));
    }
    const save = url.match(/\/api\/questions\/([^/]+)$/);
    if (save && method === "PATCH") {
      const id = save[1];
      const base = id === "q1" ? Q1 : Q2;
      return json({ question: base });
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: () => release?.() };
}

function renderPick() {
  return render(
    <HostSetupPickClient
      nightId="night-1"
      categoryId="category-1"
      categoryName="Saints"
      categoryTopic="saints"
      initialState="review"
      initialQuestions={[Q1, Q2]}
      themeKey="house"
    />,
  );
}

function photoCalls(fetchMock: ReturnType<typeof vi.fn>, id: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith(`/api/questions/${id}/photos`) &&
      ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
  ).length;
}

function libraryImgSrcs(): string[] {
  const swap = screen.getByTestId("host-gen-image-swap-layout");
  return Array.from(swap.querySelectorAll("img"))
    .map((img) => img.getAttribute("src") ?? "")
    .filter((src) => src.includes("-alt-"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Pick screen photo choice", () => {
  it("Edit → Swap image loads the library photos, not just the upload option", async () => {
    const { fetchMock } = installFetch();
    renderPick();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /swap image/i }));

    await screen.findByTestId("host-gen-image-swap-layout");
    await waitFor(() => expect(photoCalls(fetchMock, "q1")).toBe(1));
    await waitFor(() => expect(libraryImgSrcs()).toHaveLength(3));
    expect(libraryImgSrcs()[0]).toContain("q1-alt-");
    // Both choices are on screen together: library photos and her own.
    expect(screen.getByRole("button", { name: /upload your own/i })).toBeInTheDocument();
  });

  it("never shows another question's photos after Edit → Swap image", async () => {
    const { fetchMock } = installFetch();
    renderPick();

    // Look at Q2's photos from its card, then back out.
    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[1]);
    await waitFor(() => expect(libraryImgSrcs()).toHaveLength(3));
    expect(libraryImgSrcs()[0]).toContain("q2-alt-");
    fireEvent.click(screen.getByRole("button", { name: /back without changes/i }));

    // Now Q1 through Edit: it must show Q1's photos, never Q2's.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /swap image/i }));
    await waitFor(() => expect(photoCalls(fetchMock, "q1")).toBe(1));
    await waitFor(() => expect(libraryImgSrcs()).toHaveLength(3));
    for (const src of libraryImgSrcs()) expect(src).toContain("q1-alt-");
  });

  it("says the library photos are loading instead of looking empty", async () => {
    const { release } = installFetch({ holdPhotos: true });
    renderPick();

    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[0]);
    const swap = await screen.findByTestId("host-gen-image-swap-layout");
    expect(within(swap).getByText(/finding photos/i)).toBeInTheDocument();
    expect(within(swap).queryByText(/0 fresh/i)).not.toBeInTheDocument();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(libraryImgSrcs()).toHaveLength(3));
    expect(within(swap).queryByText(/finding photos/i)).not.toBeInTheDocument();
  });

  it("Back from the upload screen returns to the same library photos without a new search", async () => {
    const { fetchMock } = installFetch();
    renderPick();

    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[0]);
    await waitFor(() => expect(libraryImgSrcs()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: /upload your own/i }));
    fireEvent.click(await screen.findByRole("button", { name: /back to library/i }));

    await waitFor(() => expect(libraryImgSrcs()).toHaveLength(3));
    expect(photoCalls(fetchMock, "q1")).toBe(1);
  });
});

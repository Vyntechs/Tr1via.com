import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { HostSetupTopicClient } from "@/app/host/setup/[nightId]/topic/HostSetupTopicClient";
import { HostSetupPickClient } from "@/app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient";
import { HostGenEdit } from "@/components/host/gen/HostGenEdit";
import { HostGenImageSwap } from "@/components/host/gen/HostGenImageSwap";
import { HostGenImageUpload } from "@/components/host/gen/HostGenImageUpload";
import { buildRecentTopics } from "@/lib/host/recentTopics";
import { editQuestionEyebrow } from "@/lib/host/editQuestionEyebrow";
import type { QuestionRow } from "@/lib/supabase/types";

// The host setup screens were built from a design mock and kept the mock's
// content as defaults. The live routes never overrode them, so every week
// Heather saw someone else's topics (Pixar Movies, Local Madison, Beatles…),
// a photo list she never uploaded (Paris · Eiffel night, Café Hugo, Soul
// Fire · sign) with a bar stuck at "paris-eiffel-2024.jpg 68%", and
// "EDIT QUESTION · 6 OF 20" on whichever question she opened. Around them:
// "~ 4 SECONDS" for a pull that takes minutes, a "My photos" library that
// doesn't exist, and drag/drop and paste-a-link promises nothing handles.

const DEMO_TOPICS = [
  "Pixar Movies",
  "NFL Teams",
  "90s Music",
  "Local Madison",
  "Greek Mythology",
  "Beatles",
];

const push = vi.fn();
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  notFound: navigation.notFound,
  redirect: navigation.redirect,
}));

const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));
vi.mock("@/lib/api/auth", () => authMock);

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

const browserMock = vi.hoisted(() => ({ getSupabaseBrowser: vi.fn() }));
vi.mock("@/lib/supabase/client", () => browserMock);

// A Supabase query stand-in: every filter returns itself, awaiting it gives
// `list`, and maybeSingle() gives `single`. Records the filters it saw.
function query(list: unknown, single: unknown = null) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "is", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: single, error: null });
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
  return { builder, calls };
}

beforeEach(() => {
  push.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTopic(recent?: Parameters<typeof HostSetupTopicClient>[0]["recent"]) {
  return render(
    <HostSetupTopicClient
      nightId="night-1"
      gameId="game-1"
      gameNo={1}
      position={3}
      themeKey="house"
      recent={recent}
    />,
  );
}

describe("topic screen", () => {
  it("shows no made-up topics when the host has none to show", () => {
    renderTopic();
    expect(screen.getByRole("button", { name: /pull 20 questions/i })).toBeInTheDocument();
    expect(screen.queryByText("YOUR LAST TOPICS")).not.toBeInTheDocument();
    for (const name of DEMO_TOPICS) {
      expect(screen.queryByRole("button", { name: new RegExp(name) })).not.toBeInTheDocument();
    }
  });

  it("shows her own past topics, and a chip still only fills the box", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderTopic([
      { name: "Aquodic animals", date: "Sep 30" },
      { name: "Willie Nelson", date: "Sep 30" },
    ]);
    expect(screen.getByText("YOUR LAST TOPICS")).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: /Willie Nelson/ });
    expect(within(chip).getByText("Sep 30")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Beatles/ })).not.toBeInTheDocument();

    fireEvent.click(chip);
    expect(screen.getByPlaceholderText("Pixar Movies")).toHaveValue("Willie Nelson");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a chip labelled with the short board name fills in what she originally typed", () => {
    renderTopic([
      {
        name: "The color Green",
        topic: "The color Green, including green with envy, the color of money",
        date: "Sep 30",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /The color Green/ }));
    expect(screen.getByPlaceholderText("Pixar Movies")).toHaveValue(
      "The color Green, including green with envy, the color of money",
    );
  });

  it("doesn't promise a 4-second pull (real pulls take about 1.5–3 minutes)", () => {
    renderTopic();
    expect(screen.queryByText(/4 SECONDS/i)).not.toBeInTheDocument();
    expect(screen.getByText("TAKES A COUPLE OF MINUTES")).toBeInTheDocument();
  });
});

describe("topic page · loading her past topics", () => {
  function owned() {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host-heather", default_theme_key: "house" },
      night: { id: "night-tonight", host_id: "host-heather", theme_key: "house" },
    });
  }

  async function loadPage() {
    const { default: SetupTopicPage } = await import(
      "@/app/host/setup/[nightId]/topic/page"
    );
    return (await SetupTopicPage({
      params: Promise.resolve({ nightId: "night-tonight" }),
      searchParams: Promise.resolve({ game: "game-1", position: "3" }),
    })) as ReactElement<{ recent?: unknown }>;
  }

  it("uses her earlier nights only, newest first, with her typed topic", async () => {
    owned();
    const gameLookup = query(null, { id: "game-1", night_id: "night-tonight", game_no: 1 });
    const pastGames = query([
      { id: "g-sep30", night_id: "n-sep30" },
      { id: "g-sep23", night_id: "n-sep23" },
    ]);
    const nights = query([
      { id: "n-sep30", opened_at: "2026-09-30T23:33:05Z" },
      { id: "n-sep23", opened_at: "2026-09-23T21:36:58Z" },
    ]);
    const categories = query([
      { name: "Aquodic animals", topic: "Aquodic animals", created_at: "2026-09-27T15:15:17Z", game_id: "g-sep30" },
      { name: "Guitars", topic: "Different typeS if guitards", created_at: "2026-09-26T00:46:16Z", game_id: "g-sep30" },
      { name: "Frogs", topic: "Frogs", created_at: "2026-09-19T16:16:24Z", game_id: "g-sep23" },
      { name: "guitars ", topic: "Guitars", created_at: "2026-09-19T15:00:00Z", game_id: "g-sep23" },
    ]);
    let gamesCalls = 0;
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "games") return (gamesCalls++ === 0 ? gameLookup : pastGames).builder;
        if (table === "nights") return nights.builder;
        if (table === "categories") return categories.builder;
        throw new Error(`unexpected table ${table}`);
      },
    });

    const element = await loadPage();
    expect(element.props.recent).toEqual([
      { name: "Aquodic animals", topic: "Aquodic animals", date: "Sep 30" },
      { name: "Guitars", topic: "Different typeS if guitards", date: "Sep 30" },
      { name: "Frogs", topic: "Frogs", date: "Sep 23" },
    ]);
    expect(nights.calls).toContainEqual(["eq", ["host_id", "host-heather"]]);
    expect(nights.calls).toContainEqual(["neq", ["id", "night-tonight"]]);
  });

  it("still opens the page, without chips, if the topic lookup throws", async () => {
    owned();
    const gameLookup = query(null, { id: "game-1", night_id: "night-tonight", game_no: 1 });
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "games") return gameLookup.builder;
        throw new Error("network blip");
      },
    });
    const element = await loadPage();
    expect(element.props.recent).toEqual([]);
  });
});

describe("recent-topic chips", () => {
  it("dedupes, caps at 9, and dates in venue time", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      name: `Topic ${i}`,
      created_at: new Date(Date.UTC(2026, 8, 20 - i, 12)).toISOString(),
      night_opened_at: null,
    }));
    rows.push({ name: " topic   0 ", created_at: "2026-09-01T12:00:00Z", night_opened_at: null });
    const recent = buildRecentTopics(rows);
    expect(recent).toHaveLength(9);
    expect(recent.map((r) => r.name)).toEqual(
      Array.from({ length: 9 }, (_, i) => `Topic ${i}`),
    );
    // 01:32 UTC Sep 26 is the evening of Sep 25 in Texas.
    expect(
      buildRecentTopics([
        { name: "The color Green", created_at: "2026-09-26T01:32:22Z", night_opened_at: null },
      ]),
    ).toEqual([{ name: "The color Green", date: "Sep 25" }]);
  });

  it("orders by the date the chip shows, so the dates read newest first", () => {
    const recent = buildRecentTopics([
      // Added early for a night that was played later...
      { name: "Willie Nelson", created_at: "2026-09-12T16:00:00Z", night_opened_at: "2026-09-30T23:33:00Z" },
      // ...versus one added later for a night that was played earlier.
      { name: "Worms", created_at: "2026-09-19T16:00:00Z", night_opened_at: "2026-09-23T21:36:00Z" },
    ]);
    expect(recent.map((r) => `${r.name} ${r.date}`)).toEqual([
      "Willie Nelson Sep 30",
      "Worms Sep 23",
    ]);
  });

  it("falls back to the board name when her typed topic isn't stored", () => {
    const [missing, tooLong] = buildRecentTopics([
      { name: "Rodents", topic: "  ", created_at: "2026-09-25T17:00:00Z", night_opened_at: null },
      { name: "Subway", topic: "x".repeat(81), created_at: "2026-09-24T17:00:00Z", night_opened_at: null },
    ]);
    expect(missing).toEqual({ name: "Rodents", date: "Sep 25" });
    expect(tooLong).toEqual({ name: "Subway", date: "Sep 24" });
  });
});

describe("image screens", () => {
  it("upload: no made-up photo list and no 'My photos' library", () => {
    render(<HostGenImageUpload themeKey="house" topic="Rodents" prompt="Which rodent?" state="idle" />);
    expect(screen.getByText("WHAT MAKES A GOOD PHOTO")).toBeInTheDocument();
    expect(screen.queryByText("RECENT · MY PHOTOS")).not.toBeInTheDocument();
    expect(screen.queryByText(/Eiffel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Café Hugo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Soul Fire · sign/)).not.toBeInTheDocument();
    expect(screen.queryByText(/My photos/)).not.toBeInTheDocument();
    expect(screen.queryByText("From the library")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload new")).not.toBeInTheDocument();
  });

  it("upload: offers to choose a file, not to drop one", () => {
    render(<HostGenImageUpload themeKey="house" topic="Rodents" prompt="Which rodent?" state="idle" />);
    expect(screen.getByText("Choose a photo")).toBeInTheDocument();
    expect(screen.queryByText(/drop/i)).not.toBeInTheDocument();
  });

  it("upload: while sending, shows the real file name and no invented percent", () => {
    render(
      <HostGenImageUpload
        themeKey="house"
        topic="Rodents"
        prompt="Which rodent?"
        state="uploading"
        uploadFilename="capybara.jpg"
      />,
    );
    expect(screen.getByText("capybara.jpg")).toBeInTheDocument();
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    expect(screen.queryByText(/paris-eiffel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/about 1 second/)).not.toBeInTheDocument();
  });

  it("swap: no dead 'My photos' button and no drag or paste-a-link promise", () => {
    const onOpenUpload = vi.fn();
    render(
      <HostGenImageSwap
        themeKey="house"
        topic="Rodents"
        prompt="Which rodent?"
        candidates={[{ id: "1", url: "https://images.pexels.com/1.jpg" }]}
        onOpenUpload={onOpenUpload}
      />,
    );
    expect(screen.queryByRole("button", { name: /My photos/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/0 saved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/photos you've used before/)).not.toBeInTheDocument();
    expect(screen.queryByText(/paste a link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/drag/i)).not.toBeInTheDocument();
    // Uploading your own still opens the upload screen.
    fireEvent.click(screen.getByRole("button", { name: /upload your own/i }));
    expect(onOpenUpload).toHaveBeenCalledTimes(1);
  });
});

describe("edit popup", () => {
  it("never claims 6 OF 20 when it isn't told the position", () => {
    render(<HostGenEdit themeKey="house" topic="Rodents" />);
    expect(screen.getByText("EDIT QUESTION")).toBeInTheDocument();
    expect(screen.queryByText(/6 OF 20/)).not.toBeInTheDocument();
  });

  it("numbers from the real list, and drops the number if the question isn't in it", () => {
    expect(editQuestionEyebrow(["a", "b", "c"], "c")).toBe("EDIT QUESTION · 3 OF 3");
    expect(editQuestionEyebrow(["a", "b", "c"], "zzz")).toBe("EDIT QUESTION");
  });

  it("shows her uploaded photo labelled as her upload, not 'auto-matched from your library'", () => {
    const { container } = render(
      <HostGenEdit
        themeKey="house"
        topic="Rodents"
        imageUrl="https://example.supabase.co/storage/v1/object/public/question-images/n/q/a.jpg"
        imageSource="upload"
      />,
    );
    expect(screen.getByText("IMAGE · YOUR UPLOAD")).toBeInTheDocument();
    expect(screen.queryByText(/AUTO-MATCHED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/from your library/)).not.toBeInTheDocument();
    expect(
      container.querySelector('img[src$="/question-images/n/q/a.jpg"]'),
    ).not.toBeNull();
  });

  it("labels a stock photo as a stock photo, and says so when there's none", () => {
    const { unmount } = render(
      <HostGenEdit themeKey="house" topic="Rodents" imageUrl="https://images.pexels.com/1.jpg" imageSource="pexels" />,
    );
    expect(screen.getByText("IMAGE · STOCK PHOTO")).toBeInTheDocument();
    unmount();
    render(<HostGenEdit themeKey="house" topic="Rodents" imageUrl={null} imageSource={null} />);
    expect(screen.getByText("IMAGE · NONE")).toBeInTheDocument();
  });
});

describe("pick screen wiring", () => {
  function rows(count: number, overrides: Partial<QuestionRow> = {}): QuestionRow[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `q${i + 1}`,
      category_id: "cat-1",
      prompt: `Rodent question ${i + 1}`,
      options: ["A", "B", "C", "D"],
      correct_index: 0,
      difficulty: 3,
      point_value: null,
      source: "ai",
      image_url: null,
      image_attribution: null,
      image_source: null,
      photo_query: null,
      fact_blurb: null,
      finished_at: null,
      is_picked: false,
      played_at: null,
      ...overrides,
    })) as QuestionRow[];
  }

  function renderPick(questions: QuestionRow[]) {
    browserMock.getSupabaseBrowser.mockReturnValue({
      channel: () => {
        const channel = { on: () => channel, subscribe: vi.fn() };
        return channel;
      },
      removeChannel: vi.fn(),
      from: (table: string) => {
        if (table === "questions") return query(questions).builder;
        if (table === "categories") return query(null, { state: "review" }).builder;
        if (table === "question_generation_jobs") {
          return query(null, { attempt: 1, phase: "ready" }).builder;
        }
        return query(null, null).builder;
      },
    });
    render(
      <HostSetupPickClient
        nightId="night-1"
        categoryId="cat-1"
        categoryName="Rodents"
        categoryTopic="rodents"
        initialState="review"
        initialQuestions={questions}
        themeKey="house"
      />,
    );
  }

  it("the edit popup numbers the card she opened out of the cards on screen", async () => {
    renderPick(rows(7));
    const editButtons = await screen.findAllByRole("button", { name: "Edit" });
    expect(editButtons).toHaveLength(7);
    fireEvent.click(editButtons[2]!);
    await waitFor(() => {
      expect(screen.getByText("EDIT QUESTION · 3 OF 7")).toBeInTheDocument();
    });
    expect(screen.queryByText(/6 OF 20/)).not.toBeInTheDocument();
  });

  it("opened from YOUR BOARD, the popup doesn't show a grid number", async () => {
    const questions = rows(7);
    questions[3] = { ...questions[3]!, is_picked: true };
    renderPick(questions);
    fireEvent.click(await screen.findByTestId("pick-sidebar-edit-100"));
    await waitFor(() => {
      expect(screen.getByTestId("host-gen-edit-layout")).toBeInTheDocument();
    });
    expect(screen.getByText("EDIT QUESTION")).toBeInTheDocument();
    expect(screen.queryByText(/EDIT QUESTION · \d+ OF/)).not.toBeInTheDocument();
  });

  it("the edit popup shows the question's real uploaded photo", async () => {
    const url = "https://example.supabase.co/storage/v1/object/public/question-images/n/q1/b.jpg";
    renderPick(rows(2, { image_url: url, image_source: "upload" }));
    const [edit] = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(edit!);
    const panel = await screen.findByTestId("host-gen-edit-layout");
    expect(within(panel).getByText("IMAGE · YOUR UPLOAD")).toBeInTheDocument();
    expect(panel.querySelector(`img[src="${url}"]`)).not.toBeNull();
  });

  it("the upload screen shows the file she picked while it sends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/photos")) {
          return Promise.resolve(
            new Response(JSON.stringify({ photos: [] }), { status: 200 }),
          );
        }
        // Hold the upload open so the "uploading" view stays on screen.
        if (url === "/api/images/upload") return new Promise<Response>(() => {});
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
    renderPick(rows(3));
    const imageButtons = await screen.findAllByRole("button", { name: "Image" });
    fireEvent.click(imageButtons[0]!);
    const [uploadYourOwn] = await screen.findAllByRole("button", { name: /upload your own/i });
    fireEvent.click(uploadYourOwn!);
    await screen.findByText("Choose a photo");
    expect(screen.queryByText("RECENT · MY PHOTOS")).not.toBeInTheDocument();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "capybara-sign.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText("capybara-sign.jpg")).toBeInTheDocument();
    });
    expect(screen.queryByText(/paris-eiffel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
});

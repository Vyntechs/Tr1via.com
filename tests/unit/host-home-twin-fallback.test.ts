import { afterEach, describe, expect, it, vi } from "vitest";
import { withoutEmptyTwinNights } from "@/lib/host/loadNightTwinContent";
import type { TwinNight } from "@/lib/host/nightTwins";

// What app/host/page.tsx does with the host's nights before it builds the
// home page: hide empty twins, and on ANY failure show every night.

const RULE = { defaultVenue: "Soul Fire Pizza" };

// A night exactly as a tap on "+ Plan a new night" stores it.
const night = (id: string, created_at: string): TwinNight => ({
  id,
  created_at,
  opened_at: null,
  closed_at: null,
  venue_name: "Soul Fire Pizza",
  theme_key: null,
  scheduled_at: null,
  room_magic_enabled: false,
  is_locked: false,
  current_run_id: null,
  answer_engine: "legacy",
  answer_engine_latched_at: null,
  room_revision: 0,
  control_revision: 0,
});

// Newest first, as the page reads them. The first two are a true twin pair
// (1.07 s apart, both untouched and empty), so the lookup really runs.
const NIGHTS = [
  night("built", "2026-10-08T16:46:07.596Z"),
  night("empty-twin", "2026-10-08T16:46:06.524Z"),
  night("last-week", "2026-10-03T15:08:55.638Z"),
];
const ALL_IDS = NIGHTS.map((n) => n.id);

const freshGames = (nightId: string) =>
  [1, 2].map((no) => ({
    id: `${nightId}-g${no}`,
    night_id: nightId,
    game_no: no,
    category_count: 6,
    question_count: 7,
    state: "draft",
    started_at: null,
    ended_at: null,
  }));

// A stand-in for the admin client: from(table).select(...).in(col, ids).
function workingAdmin() {
  return {
    from: vi.fn((table: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) =>
          Promise.resolve({
            data: table === "games" ? ids.flatMap(freshGames) : [],
            error: null,
          }),
      }),
    })),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("host home page: empty twin lookup", () => {
  it("control: with a working lookup, the empty older twin is hidden", async () => {
    const admin = workingAdmin();
    const shown = await withoutEmptyTwinNights(admin as never, NIGHTS, RULE);
    expect(admin.from).toHaveBeenCalled();
    expect(shown.map((n) => n.id)).toEqual(["built", "last-week"]);
  });

  it("if the lookup throws, the page still gets every night and logs once", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = {
      from: vi.fn(() => {
        throw new Error("fetch failed");
      }),
    };
    const shown = await withoutEmptyTwinNights(admin as never, NIGHTS, RULE);
    expect(admin.from).toHaveBeenCalled();
    expect(shown.map((n) => n.id)).toEqual(ALL_IDS);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("if a query rejects partway (after games were read), every night is still shown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = workingAdmin();
    const admin = {
      from: vi.fn((table: string) =>
        table === "categories"
          ? { select: () => ({ in: () => Promise.reject(new Error("socket hang up")) }) }
          : ok.from(table),
      ),
    };
    const shown = await withoutEmptyTwinNights(admin as never, NIGHTS, RULE);
    expect(admin.from).toHaveBeenCalledWith("categories");
    expect(shown.map((n) => n.id)).toEqual(ALL_IDS);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

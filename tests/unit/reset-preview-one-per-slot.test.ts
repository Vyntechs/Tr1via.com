import { beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

// The reset-game popup says how many categories and picked questions are kept.
// A slot doubled before the one-per-slot fix must count once, as the row the
// setup screen and TV show, not as two categories.

const GAME_ID = "game-1";
const categories = [
  // Slot 1: old unlocked extra row with 2 stray picks, then the real locked one.
  { id: "cat-extra", name: "Legendary Ghost stories", game_id: GAME_ID, position: 1, state: "review", created_at: "2026-10-03T15:36:41Z" },
  { id: "cat-ghost", name: "Ghost Stories", game_id: GAME_ID, position: 1, state: "ready", created_at: "2026-10-03T15:37:09Z" },
  { id: "cat-pumpkins", name: "Pumpkins", game_id: GAME_ID, position: 2, state: "ready", created_at: "2026-10-04T15:43:02Z" },
];
const pickedRows = [
  ...Array.from({ length: 2 }, () => ({ category_id: "cat-extra" })),
  ...Array.from({ length: 7 }, () => ({ category_id: "cat-ghost" })),
  ...Array.from({ length: 7 }, () => ({ category_id: "cat-pumpkins" })),
];

function admin() {
  return {
    from: (table: string) => {
      let head = false;
      const b: Record<string, unknown> = {};
      b.select = (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      };
      for (const m of ["eq", "in", "order", "not", "is"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => {
        let result: { data: unknown; error: null; count?: number };
        if (table === "games") result = { data: [{ id: GAME_ID, state: "ready" }], error: null };
        else if (table === "categories") result = { data: categories, error: null };
        else if (table === "questions") {
          result = head
            ? { data: null, error: null, count: pickedRows.length }
            : { data: pickedRows, error: null };
        } else result = { data: null, error: null, count: 0 };
        return Promise.resolve(result).then(resolve, reject);
      };
      return b;
    },
  };
}

describe("reset popup counts · doubled board slot", () => {
  beforeEach(() => {
    adminMock.getSupabaseAdmin.mockReturnValue(admin());
  });

  it("counts a doubled slot once, with only the shown row's picked questions", async () => {
    const { fetchResetPreview } = await import("@/lib/api/resetNightCounts");
    const preview = await fetchResetPreview("night-1");
    expect(preview.categoriesKept).toBe(2);
    expect(preview.pickedQuestionsKept).toBe(14);
    expect(preview.categoryNamesSample).toEqual(["Ghost Stories", "Pumpkins"]);
  });
});

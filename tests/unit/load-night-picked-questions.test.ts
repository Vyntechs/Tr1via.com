import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  loadNightPickedQuestions,
  pickedQuestionsRetryDelayMs,
  startPickedQuestionsLoad,
} from "@/lib/host/loadNightPickedQuestions";
import { oneCategoryPerSlotOnceCounted } from "@/lib/host/oneCategoryPerSlot";

// Host phone + laptop console: the picked-question read is also the picked
// counts that choose which row of a doubled slot shows. Before this, an error
// result counted as "no picks" (so the newer EMPTY row could win), and a thrown
// read left the doubled slot blank until the games list changed.

type Result = { data: unknown; error: unknown };

function client(cats: Result | Error, qs: Result | Error) {
  const answer = (r: Result | Error) => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r));
  return {
    from: (table: string) => ({
      select: () => ({
        in: () => {
          const p = answer(table === "categories" ? cats : qs) as Promise<Result> & {
            eq: () => Promise<Result>;
          };
          p.eq = () => answer(qs);
          // The categories read is awaited directly; avoid an unhandled
          // rejection on the unused questions branch.
          p.catch(() => undefined);
          return p;
        },
      }),
    }),
  };
}

const CATS = { data: [{ id: "old" }, { id: "new" }], error: null };
const PICKS = {
  data: Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, category_id: "old", is_picked: true })),
  error: null,
};

describe("loadNightPickedQuestions", () => {
  it("returns the picked rows when both reads work", async () => {
    const out = await loadNightPickedQuestions(client(CATS, PICKS), ["g1"]);
    expect(out).toEqual({ ok: true, rows: PICKS.data });
  });

  it("an error result is a failure, not an empty list", async () => {
    expect(await loadNightPickedQuestions(client(CATS, { data: null, error: { message: "x" } }), ["g1"]))
      .toEqual({ ok: false });
    expect(await loadNightPickedQuestions(client({ data: null, error: { message: "x" } }, PICKS), ["g1"]))
      .toEqual({ ok: false });
  });

  it("a thrown read (network drop) is a failure too", async () => {
    expect(await loadNightPickedQuestions(client(CATS, new Error("offline")), ["g1"])).toEqual({ ok: false });
    expect(await loadNightPickedQuestions(client(new Error("offline"), PICKS), ["g1"])).toEqual({ ok: false });
  });
});

describe("startPickedQuestionsLoad", () => {
  it("keeps trying after an error result and after a throw, then hands over the real rows", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, rows: PICKS.data });
    const runs: Array<() => void> = [];
    const onRows = vi.fn();
    const onRetrying = vi.fn();
    startPickedQuestionsLoad({ load, onRows, onRetrying, schedule: (run) => runs.push(run) });

    await vi.waitFor(() => expect(onRetrying).toHaveBeenLastCalledWith(true));
    expect(onRows).not.toHaveBeenCalled();
    runs.shift()!();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    runs.shift()!();
    await vi.waitFor(() => expect(onRows).toHaveBeenCalledWith(PICKS.data));
    expect(onRetrying).toHaveBeenLastCalledWith(false);
    expect(runs).toHaveLength(0);
  });

  it("stops retrying when the screen goes away", async () => {
    const load = vi.fn().mockResolvedValue({ ok: false });
    const runs: Array<() => void> = [];
    const cancelSchedule = vi.fn();
    const cancel = startPickedQuestionsLoad({
      load,
      onRows: vi.fn(),
      onRetrying: vi.fn(),
      schedule: (run) => (runs.push(run), "h1"),
      cancelSchedule,
    });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    cancel();
    expect(cancelSchedule).toHaveBeenCalledWith("h1");
  });

  it("backs off and settles at one try every 10 seconds", () => {
    expect([1, 2, 3, 4, 5, 9].map(pickedQuestionsRetryDelayMs)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });

  it("while it fails, a doubled slot shows neither row (never the empty newer one)", () => {
    // What the screens do with "not loaded yet": counts null hides the doubled
    // slot instead of guessing. The old code passed empty counts here.
    const rows = [
      { id: "old", game_id: "g", position: 2, state: "ready", created_at: "2026-10-03T15:36:41Z", name: "Ghost Stories" },
      { id: "new", game_id: "g", position: 2, state: "ready", created_at: "2026-10-03T15:37:09Z", name: "Ghost Stories" },
    ];
    expect(oneCategoryPerSlotOnceCounted(rows, null).map((r) => r.id)).toEqual([]);
    expect(oneCategoryPerSlotOnceCounted(rows, new Map()).map((r) => r.id)).toEqual(["new"]);
  });

  it("both host screens use it (no inline read that treats an error as no picks)", () => {
    for (const file of [
      "app/host/phone/[nightId]/HostPhoneClient.tsx",
      "app/host/live/[nightId]/HostLiveConsoleClient.tsx",
    ]) {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src).toContain("startPickedQuestionsLoad({");
      expect(src).toContain("PICKED_QUESTIONS_RETRY_MESSAGE");
      expect(src).not.toMatch(/const \{ data: qData \} = await supa/);
    }
  });
});

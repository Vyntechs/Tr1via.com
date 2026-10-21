// The owner's rule for the loading screen: every number is real, and the
// percent and the bars never move backward during one build. These feed the
// review's real sequences (Oct 21 progress-fix review, items 1-3) through
// buildTracker + holdTracker exactly the way the loading screen does.
import { describe, expect, it } from "vitest";
import {
  buildTracker,
  holdTracker,
  type HostGenProgress,
  type Tracker,
} from "@/components/host/gen/genProgress";

type Step = [label: string, p: Partial<HostGenProgress>];

const base: HostGenProgress = {
  phase: "queued",
  target: 20,
  written: 0,
  certified: 0,
  photos: 0,
  startedAt: 0,
  lastSignalAt: 0,
};

function run(steps: Step[]) {
  let held: Tracker | null = null;
  return steps.map(([label, p]) => {
    const raw = buildTracker({ ...base, ...p });
    held = holdTracker(held, raw);
    return { label, raw, held };
  });
}

const pct = (t: Tracker) => Math.round(t.overall * 1000) / 10;

/** Fails with the step names if the percent or any bar went backward. */
function expectNeverBackward(
  rows: { label: string; t: Tracker }[],
) {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    expect(
      b.t.overall,
      `overall dropped ${pct(a.t)}% -> ${pct(b.t)}% at "${a.label}" -> "${b.label}"`,
    ).toBeGreaterThanOrEqual(a.t.overall);
    b.t.stages.forEach((s, k) => {
      expect(
        s.fraction,
        `${s.key} bar dropped at "${a.label}" -> "${b.label}"`,
      ).toBeGreaterThanOrEqual(a.t.stages[k]!.fraction);
    });
  }
}

const stage = (t: Tracker, key: "write" | "check" | "photos") =>
  t.stages.find((s) => s.key === key)!;

describe("first build, 3 questions fail the check (review item 1)", () => {
  const rows = run([
    ["queued", { phase: "queued" }],
    ["writing 7", { phase: "writing", written: 7 }],
    ["writing 20", { phase: "writing", written: 20 }],
    ["checking 0/40", { phase: "checking", written: 20, checked: 0, checkTotal: 40 }],
    ["checking 40/40", { phase: "checking", written: 20, checked: 40, checkTotal: 40 }],
    ["repairing, 17 clean", { phase: "repairing", written: 20, certified: 17, clean: 17 }],
    ["refill writing", { phase: "writing", written: 20, certified: 17, clean: 17 }],
    ["refill checking 0/8", { phase: "checking", written: 20, certified: 17, clean: 17, checked: 0, checkTotal: 8 }],
    ["refill checking 4/8", { phase: "checking", written: 20, certified: 17, clean: 17, checked: 4, checkTotal: 8 }],
    ["refill checking 8/8", { phase: "checking", written: 20, certified: 17, clean: 17, checked: 8, checkTotal: 8 }],
    ["photos 0", { phase: "images", written: 20, certified: 20, clean: 20, photos: 0 }],
    ["photos 12", { phase: "images", written: 20, certified: 20, clean: 20, photos: 12 }],
    ["ready", { phase: "ready", written: 20, certified: 20, clean: 20, photos: 19 }],
  ]);

  it("the percent and every bar on screen never move backward", () => {
    expectNeverBackward(rows.map((r) => ({ label: r.label, t: r.held })));
    expect(pct(rows.at(-1)!.held)).toBe(100);
  });

  it("the raw maths no longer drops when the refill starts checking", () => {
    // Was 74.7% -> 56.0% (the check bar reset to 0/8).
    const fromRepair = rows.slice(5).map((r) => ({ label: r.label, t: r.raw }));
    expectNeverBackward(fromRepair);
    expect(pct(rows[7]!.raw)).toBe(74.7);
    expect(pct(rows[9]!.raw)).toBe(78);
  });

  it("shows the real counts at each moment", () => {
    const repair = rows[5]!.raw;
    expect(repair.headline).toBe("Replacing 3 that failed the check");
    expect(stage(repair, "check")).toMatchObject({ count: 17, total: 20, detail: "3 to replace" });

    const refillCheck = rows[7]!.raw;
    expect(refillCheck.headline).toBe("Checking the replacements");
    expect(stage(refillCheck, "check")).toMatchObject({
      count: 17,
      total: 20,
      detail: "0/8 checks",
    });
    expect(stage(rows[9]!.raw, "check").detail).toBe("8/8 checks");
    expect(stage(rows[4]!.raw, "check")).toMatchObject({ count: 40, total: 40 });
  });

  it("holds the bar still (not faked forward) through the one real drop", () => {
    // Checks finish (78%), then 3 fail. The honest figure dips; the screen
    // holds at 78% until real photo counts pass it, and the counts stay true.
    expect(pct(rows[4]!.held)).toBe(78);
    expect(pct(rows[5]!.raw)).toBeLessThan(78);
    expect(pct(rows[5]!.held)).toBe(78);
    expect(pct(rows[9]!.held)).toBe(78);
    expect(stage(rows[5]!.held, "check").count).toBe(17);
    expect(pct(rows[11]!.held)).toBeGreaterThan(78);
  });
});

describe('"Another 20" reroll after a reload (review item 2)', () => {
  // On a reroll the old cards stay until the final swap, so the page sends
  // certified 0 the whole way. The server's `clean` count carries the truth.
  const rows = run([
    ["checking 40/40", { phase: "checking", written: 20, checked: 40, checkTotal: 40 }],
    ["repairing (broadcast)", { phase: "repairing", written: 20, clean: 17 }],
    ["refill writing", { phase: "writing", written: 20, clean: 17 }],
    ["refill checking 0/8", { phase: "checking", written: 20, clean: 17, checked: 0, checkTotal: 8 }],
    ["refill checking 8/8", { phase: "checking", written: 20, clean: 17, checked: 8, checkTotal: 8 }],
    ["saving the swap", { phase: "repairing", written: 20, clean: 20 }],
    ["photos 5", { phase: "images", written: 20, certified: 20, clean: 20, photos: 5 }],
  ]);

  it("never moves backward, and the raw maths only dips at the real failure", () => {
    expectNeverBackward(rows.map((r) => ({ label: r.label, t: r.held })));
    expectNeverBackward(rows.slice(1).map((r) => ({ label: r.label, t: r.raw })));
    // Was 78% -> 56% with "Replacing 20".
    expect(pct(rows[1]!.raw)).toBe(74.7);
  });

  it('says "Replacing 3", not "Replacing 20"', () => {
    expect(rows[1]!.raw.headline).toBe("Replacing 3 that failed the check");
    expect(rows[1]!.raw.refillNeed).toBe(3);
    expect(stage(rows[1]!.raw, "check")).toMatchObject({ count: 17, total: 20 });
    expect(rows[2]!.raw.headline).toBe("Replacing 3 that failed the check");
    expect(stage(rows[3]!.raw, "check")).toMatchObject({ count: 17, detail: "0/8 checks" });
    expect(rows[5]!.raw.headline).toBe("Saving the new questions");
  });

  it("gives no number at all when only the polled row is known", () => {
    const t = buildTracker({ ...base, phase: "repairing", written: 20, certified: 0 });
    expect(t.headline).toBe("Replacing the ones that failed the check");
    expect(t.headline).not.toMatch(/\d/);
  });
});

describe("resume after a pause, 15 saved, 2 fail the re-check (review item 3)", () => {
  // The route no longer lowers the written count to 13, and the two deleted
  // cards are still on screen for a moment (certified 15 from the cards) while
  // the server's clean count already says 13.
  const rows = run([
    // Before the pause (same screen stays up through an auto-resume).
    ["before pause: repairing", { phase: "repairing", written: 15, certified: 15, clean: 15 }],
    ["paused", { phase: "needs_attention", written: 15, certified: 15 }],
    // The resume claim is a new server attempt; the counts restart.
    ["queued", { phase: "queued", written: 15 }],
    ["re-check 0/30", { phase: "checking", written: 15, checked: 0, checkTotal: 30 }],
    ["re-check 30/30", { phase: "checking", written: 15, checked: 30, checkTotal: 30 }],
    ["repairing", { phase: "repairing", written: 15, certified: 15, clean: 13 }],
    ["refill writing 15", { phase: "writing", written: 15, certified: 13, clean: 13 }],
    ["refill writing 18", { phase: "writing", written: 18, certified: 13, clean: 13 }],
    ["refill writing 20", { phase: "writing", written: 20, certified: 13, clean: 13 }],
    ["refill checking 0/16", { phase: "checking", written: 20, certified: 13, clean: 13, checked: 0, checkTotal: 16 }],
    ["refill checking 16/16", { phase: "checking", written: 20, certified: 13, clean: 13, checked: 16, checkTotal: 16 }],
    ["photos 3", { phase: "images", written: 20, certified: 20, clean: 20, photos: 3 }],
  ]);

  it("never moves backward across the pause, and the raw maths only dips at the real failure", () => {
    expectNeverBackward(rows.map((r) => ({ label: r.label, t: r.held })));
    // The raw figure really does fall to 0% when the resumed attempt starts
    // queued; only the hold keeps the screen at the pre-pause value.
    expect(pct(rows[2]!.raw)).toBe(0);
    expect(pct(rows[2]!.held)).toBe(pct(rows[0]!.held));
    expectNeverBackward(rows.slice(5).map((r) => ({ label: r.label, t: r.raw })));
    // Was 78% -> 70.3% -> 50.7%. The re-check no longer counts 5 unwritten
    // questions as written, so it reads lower and then climbs.
    expect(pct(rows[4]!.raw)).toBe(58.5);
    expect(pct(rows[5]!.raw)).toBe(56.3);
  });

  it("keeps the written count at 15 and says how many are really being replaced", () => {
    expect(stage(rows[5]!.raw, "write").count).toBe(15);
    expect(rows[5]!.raw.headline).toBe("Replacing 7 that failed the check");
    expect(stage(rows[5]!.raw, "check")).toMatchObject({ count: 13, total: 20 });
    expect(stage(rows[4]!.raw, "check")).toMatchObject({
      count: 30,
      total: 30,
      detail: "2 checks each on 15 questions",
    });
    expect(stage(rows[6]!.raw, "write").detail).toBe("7 more");
    expect(stage(rows[9]!.raw, "check")).toMatchObject({ count: 13, detail: "0/16 checks" });
  });
});

describe("holdTracker", () => {
  it("starts fresh with no previous tracker and changes no counts", () => {
    const t = buildTracker({ ...base, phase: "writing", written: 4 });
    expect(holdTracker(null, t)).toBe(t);
    const lower = buildTracker({ ...base, phase: "writing", written: 2 });
    const held = holdTracker(t, lower);
    expect(held.overall).toBe(t.overall);
    expect(stage(held, "write").count).toBe(2);
    expect(stage(held, "write").fraction).toBe(stage(t, "write").fraction);
  });
});

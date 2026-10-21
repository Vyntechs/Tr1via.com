// The owner's rule for the loading screen: progress must be true. Every bar
// and the percent show exactly what the server's counts support, never more.
// When the true figure goes down (questions fail the check, or a pause loses
// its work), the headline says why in plain words. These feed real sequences
// (Oct 21 progress reviews) through buildTracker the way the screen does.
import { describe, expect, it } from "vitest";
import {
  buildTracker,
  STAGE_WEIGHTS,
  type HostGenProgress,
  type Tracker,
} from "@/components/host/gen/genProgress";

type Step = [label: string, p: Partial<HostGenProgress>];
type Row = { label: string; p: HostGenProgress; t: Tracker };

const base: HostGenProgress = {
  phase: "queued",
  target: 20,
  written: 0,
  certified: 0,
  photos: 0,
  startedAt: 0,
  lastSignalAt: 0,
  // These sequences are watched from the start, so any gap is failures.
  failuresKnown: true,
};

function run(steps: Step[]): Row[] {
  return steps.map(([label, over]) => {
    const p = { ...base, ...over };
    return { label, p, t: buildTracker(p) };
  });
}

const pct = (t: Tracker) => Math.round(t.overall * 1000) / 10;
const stage = (t: Tracker, key: "write" | "check" | "photos") =>
  t.stages.find((s) => s.key === key)!;

/** What the server's counts support for each bar, worked out on its own. */
function supportedFractions(p: HostGenProgress): Record<"write" | "check" | "photos", number> {
  const target = p.target;
  const certified = Math.min(target, p.certified);
  const clean = Math.min(target, p.clean ?? certified);
  let check: number;
  const unsure =
    p.clean === undefined &&
    !((p.checkTotal ?? 0) > 0) &&
    (p.phase === "checking" || p.phase === "repairing" || (p.phase === "writing" && certified > 0));
  if (unsure) {
    // No live update yet: no true clean count, so the stage adds nothing.
    check = 0;
  } else if (p.phase === "checking" && (p.checkTotal ?? 0) > 0) {
    // Already clean, plus this round's share of the target times the share
    // of its checks that are done.
    const checkTotal = p.checkTotal!;
    const checked = Math.min(checkTotal, p.checked ?? 0);
    const share = Math.min(target - clean, checkTotal / 2);
    check = (clean + share * (checked / checkTotal)) / target;
  } else if (
    p.phase === "checking" ||
    p.phase === "repairing" ||
    (clean > 0 && clean < target && p.phase === "writing")
  ) {
    check = clean / target;
  } else {
    check = certified / target;
  }
  const photoTotal = certified > 0 ? certified : target;
  return {
    write: Math.min(target, p.written) / target,
    check,
    photos: Math.min(photoTotal, p.photos) / photoTotal,
  };
}

/** Every bar and the percent equal what the counts support, never more. */
function expectTrue(rows: Row[]) {
  for (const { label, p, t } of rows) {
    const want = supportedFractions(p);
    let sum = 0;
    for (const s of t.stages) {
      expect(s.fraction, `${s.key} bar at "${label}"`).toBeCloseTo(want[s.key], 9);
      expect(s.count, `${s.key} count at "${label}"`).toBeLessThanOrEqual(s.total);
      if (!(p.phase === "checking" && (p.checkTotal ?? 0) > 0 && s.key === "check")) {
        // Outside the live check round a bar is just its own count.
        expect(s.fraction, `${s.key} bar vs count at "${label}"`).toBeCloseTo(s.count / s.total, 9);
      }
      sum += STAGE_WEIGHTS[s.key] * s.fraction;
    }
    expect(t.overall, `percent at "${label}"`).toBeCloseTo(p.phase === "ready" ? 1 : sum, 9);
  }
}

const EXPLAINS_DROP = /failed|starting over|picking up|paused/i;

/** Any step where the percent or a bar goes down says why in the headline. */
function expectDropsExplained(rows: Row[]) {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    const dropped =
      b.t.overall < a.t.overall - 1e-9 ||
      b.t.stages.some((s, k) => s.fraction < a.t.stages[k]!.fraction - 1e-9);
    if (dropped) {
      expect(
        b.t.headline,
        `"${a.label}" -> "${b.label}" went ${pct(a.t)}% -> ${pct(b.t)}% with no reason given`,
      ).toMatch(EXPLAINS_DROP);
    }
  }
}

function countDrops(rows: Row[]) {
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.t.overall < rows[i - 1]!.t.overall - 1e-9) n++;
  }
  return n;
}

describe("first build, 3 fail the check, then a refill round", () => {
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

  it("shows only what the counts support, and explains the one drop", () => {
    expectTrue(rows);
    expectDropsExplained(rows);
    expect(countDrops(rows)).toBe(1);
    expect(pct(rows.at(-1)!.t)).toBe(100);
  });

  it("drops the check bar to 17/20 when 3 fail, and says so", () => {
    expect(pct(rows[4]!.t)).toBe(78);
    expect(stage(rows[4]!.t, "check").fraction).toBe(1);
    const repair = rows[5]!.t;
    expect(pct(repair)).toBe(74.7);
    expect(stage(repair, "check")).toMatchObject({ count: 17, total: 20, fraction: 0.85, detail: "3 to replace" });
    expect(repair.headline).toBe("3 failed the check. Writing replacements");
    expect(rows[6]!.t.headline).toBe("3 failed the check. Writing replacements");
  });

  it("climbs back from 17/20 as the replacements are checked", () => {
    const refillCheck = rows[7]!.t;
    expect(refillCheck.headline).toBe("3 failed the check. Checking the replacements");
    expect(stage(refillCheck, "check")).toMatchObject({ count: 17, total: 20, detail: "0/8 checks" });
    expect(pct(refillCheck)).toBe(74.7);
    expect(pct(rows[8]!.t)).toBeGreaterThan(74.7);
    expect(stage(rows[9]!.t, "check").detail).toBe("8/8 checks");
    expect(pct(rows[9]!.t)).toBe(78);
    expect(pct(rows[11]!.t)).toBeGreaterThan(78);
  });
});

describe("a second refill round where 1 more fails", () => {
  const rows = run([
    ["checking 40/40", { phase: "checking", written: 20, checked: 40, checkTotal: 40 }],
    ["repairing, 17 clean", { phase: "repairing", written: 20, certified: 17, clean: 17 }],
    ["refill checking 6/6", { phase: "checking", written: 20, certified: 17, clean: 17, checked: 6, checkTotal: 6 }],
    ["repairing, 19 clean", { phase: "repairing", written: 20, certified: 19, clean: 19 }],
    ["refill 2 writing", { phase: "writing", written: 20, certified: 19, clean: 19 }],
    ["refill 2 checking 1/2", { phase: "checking", written: 20, certified: 19, clean: 19, checked: 1, checkTotal: 2 }],
    ["photos 4", { phase: "images", written: 20, certified: 20, clean: 20, photos: 4 }],
  ]);

  it("explains each drop with the real number that failed", () => {
    expectTrue(rows);
    expectDropsExplained(rows);
    expect(pct(rows[2]!.t)).toBe(78);
    expect(pct(rows[3]!.t)).toBe(76.9);
    expect(rows[3]!.t.headline).toBe("1 failed the check. Writing a replacement");
    expect(rows[5]!.t.headline).toBe("1 failed the check. Checking the replacement");
  });
});

describe('"Another 20" reroll after a reload', () => {
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

  it("shows only what the counts support, and explains the drop", () => {
    expectTrue(rows);
    expectDropsExplained(rows);
    expect(pct(rows[1]!.t)).toBe(74.7);
  });

  it('says "3 failed", not "Replacing 20"', () => {
    expect(rows[1]!.t.headline).toBe("3 failed the check. Writing replacements");
    expect(rows[1]!.t.refillNeed).toBe(3);
    expect(stage(rows[1]!.t, "check")).toMatchObject({ count: 17, total: 20 });
    expect(stage(rows[3]!.t, "check")).toMatchObject({ count: 17, detail: "0/8 checks" });
    expect(rows[5]!.t.headline).toBe("Saving the new questions");
  });

  it("gives no number and claims nothing when only the polled row is known", () => {
    const t = buildTracker({ ...base, phase: "repairing", written: 20, certified: 0 });
    expect(t.headline).toBe("Fact-checking answers");
    expect(stage(t, "check")).toMatchObject({
      known: false,
      fraction: 0,
      detail: "waiting for the next update",
    });
    expect(pct(t)).toBe(56);
  });
});

describe("round-1 pause, auto-resumed from zero (review 3, item 1)", () => {
  // Nothing is saved until a round's checks finish, so the resumed attempt
  // writes all 20 again. The screen stays up through the resume.
  const again = { resumedWith: 0 };
  const rows = run([
    ["writing 20", { phase: "writing", written: 20 }],
    ["checking 16/40", { phase: "checking", written: 20, checked: 16, checkTotal: 40 }],
    ["paused", { phase: "needs_attention", written: 20 }],
    ["resume, no counts yet", { ...again, phase: "writing", written: 0 }],
    ["resume writing 5", { ...again, phase: "writing", written: 5, clean: 0 }],
    ["resume writing 15", { ...again, phase: "writing", written: 15, clean: 0 }],
    ["resume writing 20", { ...again, phase: "writing", written: 20, clean: 0 }],
    ["resume checking 10/40", { ...again, phase: "checking", written: 20, clean: 0, checked: 10, checkTotal: 40 }],
    ["resume checking 40/40", { ...again, phase: "checking", written: 20, clean: 0, checked: 40, checkTotal: 40 }],
    ["all clean, saving", { ...again, phase: "repairing", written: 20, certified: 20, clean: 20 }],
    ["photos 6", { ...again, phase: "images", written: 20, certified: 20, clean: 20, photos: 6 }],
  ]);

  it("shows the real restart instead of a full bar, and says why", () => {
    expectTrue(rows);
    expectDropsExplained(rows);
    expect(pct(rows[1]!.t)).toBe(64.8);
    expect(rows[2]!.t.headline).toBe("Build paused");
    expect(pct(rows[3]!.t)).toBe(0);
    expect(rows[3]!.t.headline).toBe("Starting over after a pause. Writing questions");
    const w5 = rows[4]!.t;
    expect(pct(w5)).toBe(14);
    expect(stage(w5, "write")).toMatchObject({ count: 5, total: 20, fraction: 0.25 });
    expect(stage(w5, "check").fraction).toBe(0);
    expect(pct(rows[5]!.t)).toBe(42);
    expect(rows[7]!.t.headline).toBe("Starting over after a pause. Fact-checking answers");
    expect(pct(rows[7]!.t)).toBe(61.5);
  });

  it("drops the restart note once the new round's questions pass", () => {
    expect(rows[9]!.t.headline).toBe("Saving the new questions");
    expect(rows[10]!.t.headline).toBe("Finding photos");
  });

  it("an ordinary first build never mentions a pause", () => {
    const t = buildTracker({ ...base, phase: "writing", written: 5 });
    expect(t.headline).toBe("Writing questions");
  });
});

describe("pause with 15 saved, 2 fail the re-check", () => {
  // The resume re-checks the 15 saved questions, then writes the rest. The
  // route keeps the written count at 15 and sends the clean count (13) while
  // the 2 deleted cards may still be on screen (certified 15 from the cards).
  const saved = { resumedWith: 15 };
  const rows = run([
    ["before pause: repairing", { phase: "repairing", written: 20, certified: 15, clean: 15 }],
    ["paused", { phase: "needs_attention", written: 20, certified: 15 }],
    ["queued", { ...saved, phase: "queued", written: 15 }],
    ["re-check 0/30", { ...saved, phase: "checking", written: 15, checked: 0, checkTotal: 30 }],
    ["re-check 30/30", { ...saved, phase: "checking", written: 15, checked: 30, checkTotal: 30 }],
    ["repairing", { ...saved, phase: "repairing", written: 15, certified: 15, clean: 13 }],
    ["refill writing 15", { ...saved, phase: "writing", written: 15, certified: 13, clean: 13 }],
    ["refill writing 18", { ...saved, phase: "writing", written: 18, certified: 13, clean: 13 }],
    ["refill writing 20", { ...saved, phase: "writing", written: 20, certified: 13, clean: 13 }],
    ["refill checking 0/16", { ...saved, phase: "checking", written: 20, certified: 13, clean: 13, checked: 0, checkTotal: 16 }],
    ["refill checking 16/16", { ...saved, phase: "checking", written: 20, certified: 13, clean: 13, checked: 16, checkTotal: 16 }],
    ["photos 3", { ...saved, phase: "images", written: 20, certified: 20, clean: 20, photos: 3 }],
  ]);

  it("shows only what the counts support, and explains every drop", () => {
    expectTrue(rows);
    expectDropsExplained(rows);
    expect(pct(rows[1]!.t)).toBe(72.5);
    expect(pct(rows[2]!.t)).toBe(42);
    expect(pct(rows[4]!.t)).toBe(58.5);
    expect(pct(rows[5]!.t)).toBe(56.3);
    expect(pct(rows[10]!.t)).toBe(78);
  });

  it("says what really happened at each step", () => {
    expect(rows[0]!.t.headline).toBe("5 failed the check. Writing replacements");
    expect(rows[2]!.t.headline).toBe("Picking up after a pause");
    expect(rows[3]!.t.headline).toBe("Picking up after a pause. Re-checking the 15 saved");
    expect(stage(rows[4]!.t, "check")).toMatchObject({
      count: 30,
      total: 30,
      detail: "2 checks each on 15 questions",
    });
    // 2 failed and 5 were never written: not "7 failed the check".
    expect(rows[5]!.t.headline).toBe("2 failed the re-check. Writing 7 more");
    expect(stage(rows[5]!.t, "write").count).toBe(15);
    expect(stage(rows[5]!.t, "check")).toMatchObject({ count: 13, total: 20 });
    expect(stage(rows[6]!.t, "write").detail).toBe("7 more");
    expect(rows[9]!.t.headline).toBe("2 failed the re-check. Checking the replacements");
    expect(stage(rows[9]!.t, "check")).toMatchObject({ count: 13, detail: "0/16 checks" });
  });

  it("says nothing failed when every saved question passes the re-check", () => {
    const t = buildTracker({ ...base, ...saved, phase: "repairing", written: 15, certified: 15, clean: 15 });
    expect(t.headline).toBe("Picking up after a pause. Writing 5 more");
  });
});

describe("reload during a resume, before the first live update", () => {
  // Only the polled job row is known. It has no clean count, and the cards
  // still include the 2 the re-check deleted, so certified reads 15.
  it("shows the check stage with no number and leaves it out of the percent", () => {
    const rows = run([
      ["re-check, polled row only", { resumedWith: 15, phase: "checking", written: 15, certified: 15 }],
      ["repairing, polled row only", { phase: "repairing", written: 15, certified: 15, failuresKnown: false }],
      ["refill writing, polled row only", { phase: "writing", written: 18, certified: 15, failuresKnown: false }],
      ["first live update", { phase: "writing", written: 18, certified: 13, clean: 13, failuresKnown: false }],
    ]);
    expectTrue(rows);
    for (const r of rows.slice(0, 3)) {
      expect(stage(r.t, "check"), r.label).toMatchObject({
        known: false,
        fraction: 0,
        detail: "waiting for the next update",
      });
      // No guessed refill number either.
      expect(r.t.refillNeed, r.label).toBe(0);
      expect(r.t.headline, r.label).not.toMatch(/\d+ (failed|more)/);
    }
    expect(pct(rows[0]!.t)).toBe(42);
    expect(rows[0]!.t.headline).toBe("Picking up after a pause. Re-checking the 15 saved");
    // Was 75% check bar (15/20 from the cards) while the server held 13.
    expect(pct(rows[2]!.t)).toBe(50.4);
    const live = rows[3]!.t;
    expect(stage(live, "check")).toMatchObject({ known: true, count: 13, total: 20 });
  });

  it("still counts the polled row when it is the server's own saved total", () => {
    const t = buildTracker({ ...base, phase: "images", written: 20, certified: 18, photos: 6 });
    expect(stage(t, "check")).toMatchObject({ known: true, count: 18, total: 20 });
  });
});

describe("reload mid-resume: the screen doesn't know how many failed", () => {
  // 15 were saved, 2 failed the re-check, 5 were never written. After a
  // reload the screen has no memory of the resume, so a gap of 7 could be
  // 7 failures or 2 failures plus 5 never written. It must not claim either.
  const unknown = { failuresKnown: false };
  const rows = run([
    ["repairing", { ...unknown, phase: "repairing", written: 15, certified: 13, clean: 13 }],
    ["refill writing 18", { ...unknown, phase: "writing", written: 18, certified: 13, clean: 13 }],
    ["refill writing 20", { ...unknown, phase: "writing", written: 20, certified: 13, clean: 13 }],
    ["refill checking 8/16", { ...unknown, phase: "checking", written: 20, certified: 13, clean: 13, checked: 8, checkTotal: 16 }],
    ["all clean, repairing", { ...unknown, phase: "repairing", written: 20, certified: 20, clean: 20 }],
  ]);

  it("uses neutral words and never claims failures", () => {
    expectTrue(rows);
    for (const r of rows) expect(r.t.headline, r.label).not.toMatch(/fail/i);
    expect(rows[0]!.t.headline).toBe("Writing 7 more");
    expect(rows[1]!.t.headline).toBe("Writing 7 more");
    expect(rows[3]!.t.headline).toBe("Fact-checking answers");
    expect(rows[4]!.t.headline).toBe("Saving the new questions");
    // The real counts still show.
    expect(stage(rows[0]!.t, "check")).toMatchObject({ known: true, count: 13, total: 20 });
    expect(stage(rows[1]!.t, "write").detail).toBe("7 more");
  });

  it("doesn't claim failures when every clean count is known but the history isn't", () => {
    const t = buildTracker({ ...base, ...unknown, phase: "repairing", written: 20, certified: 0, clean: 0 });
    expect(t.headline).toBe("Writing 20 more");
  });

  it("a build watched from the start still names the real number", () => {
    const t = buildTracker({ ...base, phase: "repairing", written: 20, certified: 17, clean: 17 });
    expect(t.headline).toBe("3 failed the check. Writing replacements");
  });
});

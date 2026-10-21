// Question engine switch (step 2) — the per-host "classic" / "new" setting.
//
// The fail-safe comes first: Vercel previews use the live database, where
// host_question_engine_settings does not exist until the migration is applied
// by hand. A missing table, any error, a slow read, no row, or a junk value
// must all mean "classic", and the build must go ahead as normal.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  parseQuestionEngine,
  readAllQuestionEngines,
  readHostQuestionEngine,
  runWithQuestionEngine,
} from "@/lib/ai/question-engine";
import {
  createQuestionGenerationReportAccumulator,
  questionGenerationReportInsertFromSnapshot,
  type QuestionGenerationReportContext,
} from "@/lib/ai/question-generation-report";

type Admin = Parameters<typeof readHostQuestionEngine>[0];

/** A fake admin client whose single-row read resolves to `result`. */
function adminReturning(result: unknown): { admin: Admin; from: ReturnType<typeof vi.fn> } {
  const maybeSingle = vi.fn(() =>
    result instanceof Promise ? result : Promise.resolve(result),
  );
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  }));
  return { admin: { from } as unknown as Admin, from };
}

const MISSING_TABLE = {
  data: null,
  error: {
    code: "PGRST205",
    message: "Could not find the table 'public.host_question_engine_settings' in the schema cache",
  },
};

describe("question engine · fail-safe", () => {
  it("table missing => classic, and the build still runs (classic runner, same args)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, from } = adminReturning(MISSING_TABLE);

    const engine = await readHostQuestionEngine(admin, "host-1");
    expect(engine).toBe("classic");
    expect(from).toHaveBeenCalledWith("host_question_engine_settings");

    const classic = vi.fn(async () => {});
    const next = vi.fn(async () => {});
    const args = { categoryId: "cat-1", attempt: 1 };
    await runWithQuestionEngine(engine, { classic, new: next }, args);
    expect(classic).toHaveBeenCalledTimes(1);
    expect(classic).toHaveBeenCalledWith(args);
    expect(next).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a thrown read (network failure) => classic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin } = adminReturning(Promise.reject(new Error("fetch failed")));
    await expect(readHostQuestionEngine(admin, "host-1")).resolves.toBe("classic");
    warn.mockRestore();
  });

  it("a hung read => classic after the time limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin } = adminReturning(new Promise(() => {}));
    await expect(readHostQuestionEngine(admin, "host-1", 20)).resolves.toBe("classic");
    warn.mockRestore();
  });

  it("a client that cannot even build the query => classic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = {
      from: () => {
        throw new Error("boom");
      },
    } as unknown as Admin;
    await expect(readHostQuestionEngine(admin, "host-1")).resolves.toBe("classic");
    warn.mockRestore();
  });
});

describe("question engine · reader", () => {
  it("no row => classic", async () => {
    const { admin } = adminReturning({ data: null, error: null });
    await expect(readHostQuestionEngine(admin, "host-1")).resolves.toBe("classic");
  });

  it("'new' => new", async () => {
    const { admin } = adminReturning({ data: { engine: "new" }, error: null });
    await expect(readHostQuestionEngine(admin, "host-1")).resolves.toBe("new");
  });

  it("'classic' => classic", async () => {
    const { admin } = adminReturning({ data: { engine: "classic" }, error: null });
    await expect(readHostQuestionEngine(admin, "host-1")).resolves.toBe("classic");
  });

  it("junk values => classic", () => {
    for (const junk of ["NEW", " new", "v2", "", null, undefined, 1, true, {}]) {
      expect(parseQuestionEngine(junk)).toBe("classic");
    }
    expect(parseQuestionEngine("new")).toBe("new");
  });

  it("dashboard read: error => empty map (everyone classic)", async () => {
    const admin = {
      from: () => ({ select: async () => MISSING_TABLE }),
    } as unknown as Admin;
    const engines = await readAllQuestionEngines(admin);
    expect(engines.size).toBe(0);
  });

  it("dashboard read: hung database => everyone classic after the time limit", async () => {
    const admin = {
      from: () => ({ select: () => new Promise(() => {}) }),
    } as unknown as Admin;
    const engines = await readAllQuestionEngines(admin, 20);
    expect(engines.size).toBe(0);
  });

  it("dashboard read: thrown error => everyone classic", async () => {
    const admin = {
      from: () => ({ select: () => Promise.reject(new Error("fetch failed")) }),
    } as unknown as Admin;
    const engines = await readAllQuestionEngines(admin, 20);
    expect(engines.size).toBe(0);
  });

  it("dashboard read: rows map to engines, junk => classic", async () => {
    const admin = {
      from: () => ({
        select: async () => ({
          data: [
            { host_id: "a", engine: "new" },
            { host_id: "b", engine: "weird" },
          ],
          error: null,
        }),
      }),
    } as unknown as Admin;
    const engines = await readAllQuestionEngines(admin);
    expect(engines.get("a")).toBe("new");
    expect(engines.get("b")).toBe("classic");
  });
});

describe("question engine · build branch", () => {
  it("classic and new call the same builder with identical args", async () => {
    const builder = vi.fn(async (_args: { categoryId: string; attempt: number }) => {});
    const args = { categoryId: "cat-1", attempt: 2 };

    await runWithQuestionEngine("classic", { classic: builder, new: builder }, args);
    await runWithQuestionEngine("new", { classic: builder, new: builder }, args);

    expect(builder).toHaveBeenCalledTimes(2);
    expect(builder.mock.calls[0]).toEqual(builder.mock.calls[1]);
    expect(builder.mock.calls[0][0]).toBe(args);
    expect(builder.mock.calls[1][0]).toBe(args);
  });

  it("'new' goes to the new runner", async () => {
    const classic = vi.fn(async () => {});
    const next = vi.fn(async () => {});
    await runWithQuestionEngine("new", { classic, new: next }, { x: 1 });
    expect(next).toHaveBeenCalledWith({ x: 1 });
    expect(classic).not.toHaveBeenCalled();
  });

  it("a builder failure still reaches the route's own failure handling", async () => {
    const err = new Error("writer failed");
    await expect(
      runWithQuestionEngine("classic", { classic: async () => { throw err; }, new: async () => {} }, {}),
    ).rejects.toBe(err);
  });

  it("the generate route reads the engine once; classic runs the job untouched, new swaps only the writer", () => {
    const route = readFileSync("app/api/categories/[id]/generate/route.ts", "utf8");
    expect(route.match(/readHostQuestionEngine\(/g)).toHaveLength(1);
    // Step 4: classic is today's job with no writer passed; new is the same
    // job with the new writer. Nothing else differs between the two.
    expect(route).toMatch(
      /\{\s*classic: runGenerationJob,\s*new: \(args\) => runGenerationJob\(\{ \.\.\.args, writeQuestions: generateQuestionsNew \}\),\s*\}/,
    );
    expect(route.match(/writeQuestions: generateQuestionsNew/g)).toHaveLength(1);
    expect(route).toContain("(opts.writeQuestions ?? generateQuestions)(");
    // The writer is the only engine-specific input to the job.
    expect(route.match(/writeQuestions/g)).toHaveLength(3);
    expect(route).toContain("reportContext: { ...reportContext, questionEngine }");
    // The read happens inside the scheduled build, before it runs.
    expect(route).toMatch(
      /after\(async \(\) => \{[\s\S]*?readHostQuestionEngine\(admin, owned\.host\.id\)[\s\S]*?runWithQuestionEngine\(/,
    );
  });
});

describe("question engine · hidden log in the build report", () => {
  const context: QuestionGenerationReportContext = {
    categoryId: "c",
    gameId: "g",
    nightId: "n",
    hostId: "h",
    categoryName: "Cats",
    topic: "cats",
    mode: "initial",
  };
  const snapshot = () =>
    createQuestionGenerationReportAccumulator({ requestedCount: 20, verifyPasses: 2 }).snapshot(
      "completed",
    );

  it("stores which engine ran inside the report JSON", () => {
    const insert = questionGenerationReportInsertFromSnapshot(
      { ...context, questionEngine: "new" },
      snapshot(),
    );
    expect((insert.report as Record<string, unknown>).questionEngine).toBe("new");
    expect(Object.keys(insert)).not.toContain("question_engine");
  });

  it("leaves the report JSON unchanged when no engine is given", () => {
    const insert = questionGenerationReportInsertFromSnapshot(context, snapshot());
    expect(insert.report as Record<string, unknown>).not.toHaveProperty("questionEngine");
  });
});

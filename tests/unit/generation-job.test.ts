import { describe, expect, it } from "vitest";
import {
  generationProgressFromRow,
  readGenerationJob,
  updateGenerationJob,
  updateGenerationJobForAttempt,
  type QuestionGenerationJobRow,
} from "@/lib/ai/generation-job";
import { vi } from "vitest";

const NOW = Date.parse("2026-07-18T12:00:00.000Z");

function row(
  overrides: Partial<QuestionGenerationJobRow> = {},
): QuestionGenerationJobRow {
  return {
    id: "job-1",
    category_id: "category-1",
    game_id: "game-1",
    night_id: "night-1",
    host_id: "host-1",
    phase: "queued",
    target_count: 20,
    written_count: 0,
    certified_count: 0,
    image_count: 0,
    attempt: 1,
    last_error: null,
    heartbeat_at: "2026-07-18T11:59:55.000Z",
    created_at: "2026-07-18T11:59:50.000Z",
    updated_at: "2026-07-18T11:59:55.000Z",
    ...overrides,
  };
}

describe("generationProgressFromRow", () => {
  it("describes real writing and certification counts without a fake percentage", () => {
    expect(
      generationProgressFromRow(
        row({ phase: "writing", written_count: 8, certified_count: 3 }),
        NOW,
      ),
    ).toMatchObject({
      phase: "writing",
      targetCount: 20,
      writtenCount: 8,
      certifiedCount: 3,
      attempt: 1,
      statusLine: "8 of 20 question choices written",
    });

    expect(
      generationProgressFromRow(
        row({ phase: "checking", written_count: 20, certified_count: 12 }),
        NOW,
      ).statusLine,
    ).toBe("12 of 20 question choices certified");
  });

  it("shows the exact shortfall while repairing", () => {
    expect(
      generationProgressFromRow(
        row({ phase: "repairing", certified_count: 17 }),
        NOW,
      ).statusLine,
    ).toBe("3 question choices still needed");
  });

  it("keeps optional image progress separate from certification", () => {
    const progress = generationProgressFromRow(
      row({ phase: "images", certified_count: 20, image_count: 7 }),
      NOW,
    );
    expect(progress.statusLine).toBe("7 of 20 optional images added");
    expect(progress.ready).toBe(false);
    expect(progress.certifiedCount).toBe(20);
  });

  it("never reports ready below the certified target", () => {
    const progress = generationProgressFromRow(
      row({ phase: "ready", certified_count: 19, image_count: 19 }),
      NOW,
    );
    expect(progress.phase).toBe("needs_attention");
    expect(progress.ready).toBe(false);
    expect(progress.statusLine).toMatch(/1 question choice still needs checking/i);
  });

  it("turns a stale nonterminal heartbeat into an honest needs-attention state", () => {
    const progress = generationProgressFromRow(
      row({
        phase: "checking",
        certified_count: 9,
        heartbeat_at: "2026-07-18T11:55:00.000Z",
      }),
      NOW,
      90_000,
    );
    expect(progress.phase).toBe("needs_attention");
    expect(progress.statusLine).toBe("Generation stopped updating. Your 9 certified choices are safe.");
  });

  it("surfaces the safe server error without discarding certified work", () => {
    const progress = generationProgressFromRow(
      row({
        phase: "needs_attention",
        certified_count: 14,
        last_error: "The question writer did not respond.",
      }),
      NOW,
    );
    expect(progress.statusLine).toBe("The question writer did not respond. Your 14 certified choices are safe.");
    expect(progress.remainingCount).toBe(6);
  });
});

function jobClient(resultRow: QuestionGenerationJobRow | null = row()) {
  const maybeSingle = vi.fn(async () => ({ data: resultRow, error: null }));
  const eqAfterSelect = vi.fn(() => ({ maybeSingle }));
  const eqAfterUpdate = vi.fn(async () => ({ data: null, error: null }));
  const select = vi.fn(() => ({ eq: eqAfterSelect }));
  const update = vi.fn(() => ({ eq: eqAfterUpdate }));
  const from = vi.fn(() => ({ select, update }));
  return {
    client: { from },
    spies: { from, select, update, eqAfterUpdate },
  };
}

describe("generation job persistence", () => {
  it("reads the current category job from the dedicated table", async () => {
    const { client, spies } = jobClient();
    await expect(readGenerationJob(client, "category-1")).resolves.toMatchObject({
      id: "job-1",
    });
    expect(spies.from).toHaveBeenCalledWith("question_generation_jobs");
  });

  it("rejects an old worker progress write after a replacement claim", async () => {
    let stored = row({ phase: "queued", attempt: 3 });
    const client = fencingClient(() => stored, (next) => {
      stored = next;
    });

    await expect(
      updateGenerationJobForAttempt(
        client as never,
        "category-1",
        2,
        { phase: "checking", certified_count: 12 },
        "2026-07-20T12:02:00.000Z",
      ),
    ).resolves.toBe(false);
    expect(stored).toMatchObject({ phase: "queued", attempt: 3, certified_count: 0 });
  });

  it("allows the current fenced worker to record its progress", async () => {
    let stored = row({ phase: "queued", attempt: 3 });
    const client = fencingClient(() => stored, (next) => {
      stored = next;
    });

    await expect(
      updateGenerationJobForAttempt(
        client as never,
        "category-1",
        3,
        { phase: "checking", certified_count: 12 },
        "2026-07-20T12:02:00.000Z",
      ),
    ).resolves.toBe(true);
    expect(stored).toMatchObject({ phase: "checking", attempt: 3, certified_count: 12 });
  });

  it("updates heartbeat and the requested real progress fields", async () => {
    const { client, spies } = jobClient();
    await updateGenerationJob(
      client,
      "category-1",
      { phase: "checking", certified_count: 11 },
      "2026-07-18T12:00:00.000Z",
    );
    expect(spies.update).toHaveBeenCalledWith({
      phase: "checking",
      certified_count: 11,
      heartbeat_at: "2026-07-18T12:00:00.000Z",
      updated_at: "2026-07-18T12:00:00.000Z",
    });
  });
});

function fencingClient(
  read: () => QuestionGenerationJobRow,
  write: (next: QuestionGenerationJobRow) => void,
) {
  return {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq(column: string, value: string | number) {
            filters[column] = value;
            return query;
          },
          select() {
            return {
              maybeSingle: async () => {
                const stored = read();
                const matches =
                  filters.category_id === stored.category_id &&
                  (filters.attempt === undefined || filters.attempt === stored.attempt) &&
                  (filters.phase === undefined || filters.phase === stored.phase) &&
                  (filters.heartbeat_at === undefined ||
                    filters.heartbeat_at === stored.heartbeat_at);
                if (!matches) return { data: null, error: null };
                const next = { ...stored, ...values } as QuestionGenerationJobRow;
                write(next);
                return { data: next, error: null };
              },
            };
          },
        };
        return query;
      },
    }),
  };
}

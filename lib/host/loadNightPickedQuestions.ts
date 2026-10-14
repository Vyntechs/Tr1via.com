// The host phone and the laptop console load every picked question for the
// night. Those rows are also the picked counts that decide which row of a
// doubled slot is shown (lib/host/oneCategoryPerSlot.ts).
//
// A failed read must not count as "no picks": empty counts let the newer EMPTY
// row of a doubled slot win over the older row that holds the real picks. And a
// read that throws must not leave a doubled slot blank for good. So:
//   - a read that errors or throws is a failure, never an empty result;
//   - on failure nothing is replaced: if an earlier load worked, its counts
//     stay in use, otherwise the doubled slot keeps waiting (clean slots show
//     as normal);
//   - it tries again, backing off up to every 10 s, until a load works, and the
//     screen shows RETRY_MESSAGE meanwhile.

import type { QuestionRow } from "@/lib/supabase/types";

export type PickedQuestionsLoad = { ok: true; rows: QuestionRow[] } | { ok: false };

export const PICKED_QUESTIONS_RETRY_MESSAGE =
  "Couldn't load the board's questions yet. Trying again…";

interface ReadResult {
  data: unknown;
  error: unknown;
}

interface BrowserClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): PromiseLike<ReadResult> & {
        eq(column: string, value: unknown): PromiseLike<ReadResult>;
      };
    };
  };
}

export async function loadNightPickedQuestions(
  // The browser Supabase client. Typed loosely here: only the two reads below
  // are used, and the full generated types are too deep to restate.
  client: unknown,
  gameIds: string[],
): Promise<PickedQuestionsLoad> {
  const supa = client as BrowserClient;
  try {
    const cats = await supa.from("categories").select("id").in("game_id", gameIds);
    if (cats.error) return { ok: false };
    const catIds = ((cats.data ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (catIds.length === 0) return { ok: true, rows: [] };
    const qs = await supa
      .from("questions")
      .select("*")
      .in("category_id", catIds)
      .eq("is_picked", true);
    if (qs.error) return { ok: false };
    return { ok: true, rows: (qs.data ?? []) as QuestionRow[] };
  } catch {
    return { ok: false };
  }
}

/** A small fixed note, bottom left, so it never covers the round controls. */
export const PICKED_RETRY_NOTE_STYLE = {
  position: "fixed",
  left: 12,
  bottom: 12,
  zIndex: 40,
  margin: 0,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(20,20,20,.88)",
  color: "#FFF",
  fontSize: 13,
} as const;

export function pickedQuestionsRetryDelayMs(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures - 1), 10_000);
}

/**
 * Load until it works. `onRows` runs once, with real rows; `onRetrying(true)`
 * after each failure, `onRetrying(false)` on success. Returns a cancel function
 * for the effect cleanup.
 */
export function startPickedQuestionsLoad(opts: {
  load: () => Promise<PickedQuestionsLoad>;
  onRows: (rows: QuestionRow[]) => void;
  onRetrying: (retrying: boolean) => void;
  schedule?: (run: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
}): () => void {
  const schedule = opts.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancelSchedule =
    opts.cancelSchedule ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let cancelled = false;
  let handle: unknown = null;
  let failures = 0;

  const attempt = async () => {
    const result = await opts.load();
    if (cancelled) return;
    if (result.ok) {
      opts.onRetrying(false);
      opts.onRows(result.rows);
      return;
    }
    failures += 1;
    opts.onRetrying(true);
    handle = schedule(() => void attempt(), pickedQuestionsRetryDelayMs(failures));
  };
  void attempt();

  return () => {
    cancelled = true;
    if (handle !== null) cancelSchedule(handle);
  };
}

// Per-host question-builder switch: "classic" (today's builder) or "new".
//
// The setting lives in host_question_engine_settings (one row per host, no
// row = classic). Step 2 of the question-engine plan only adds the switch:
// "new" still runs the exact same builder as "classic" until step 4.
//
// FAIL-SAFE: every read here falls back to "classic" — a missing table
// (Vercel previews run against the live database, where the table does not
// exist until the migration is applied by hand), a database error, a thrown
// error, a slow read, no row, or any value other than exactly "new". A build
// must never stop because this setting could not be read.

import type { getSupabaseAdmin } from "@/lib/supabase/admin";

export type QuestionEngine = "classic" | "new";

export const QUESTION_ENGINES = ["classic", "new"] as const;

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/** How long a build waits for the setting before going ahead with classic. */
export const QUESTION_ENGINE_READ_TIMEOUT_MS = 3000;

/** Only the exact string "new" means new; anything else is classic. */
export function parseQuestionEngine(value: unknown): QuestionEngine {
  return value === "new" ? "new" : "classic";
}

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** One host's engine. Never throws; any problem means "classic". */
export async function readHostQuestionEngine(
  admin: AdminClient,
  hostId: string,
  timeoutMs: number = QUESTION_ENGINE_READ_TIMEOUT_MS,
): Promise<QuestionEngine> {
  try {
    const { data, error } = await withTimeout(
      admin
        .from("host_question_engine_settings")
        .select("engine")
        .eq("host_id", hostId)
        .maybeSingle(),
      timeoutMs,
    );
    if (error) {
      console.warn(
        `[question-engine] could not read setting, using classic: ${error.message ?? "unknown error"}`,
      );
      return "classic";
    }
    return parseQuestionEngine(data?.engine);
  } catch (err) {
    console.warn(
      `[question-engine] could not read setting, using classic: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "classic";
  }
}

/** Every host's engine, for the founder dashboard. Never throws; hosts
 *  missing from the map (or every host, on any error) are classic. */
export async function readAllQuestionEngines(
  admin: AdminClient,
  timeoutMs: number = QUESTION_ENGINE_READ_TIMEOUT_MS,
): Promise<Map<string, QuestionEngine>> {
  try {
    const { data, error } = await withTimeout(
      admin.from("host_question_engine_settings").select("host_id, engine"),
      timeoutMs,
    );
    if (error || !data) return new Map();
    const engines = new Map<string, QuestionEngine>();
    for (const row of data) engines.set(row.host_id, parseQuestionEngine(row.engine));
    return engines;
  } catch {
    /* timeout or thrown error: everyone shows as classic */
    return new Map();
  }
}

/**
 * Runs one build with the engine chosen for it. The engine is decided once
 * per build by the caller (read at the top of the request) and passed in.
 * Step 2: both runners are today's builder, called with the very same args.
 */
export async function runWithQuestionEngine<Args>(
  engine: QuestionEngine,
  runners: Record<QuestionEngine, (args: Args) => Promise<void>>,
  args: Args,
): Promise<void> {
  const runner = runners[engine] ?? runners.classic;
  await runner(args);
}

// Let a slot's category take a NEW topic in place while it is still empty.
//
// The setup flow that needs this: the host types "Ghost Storys", the row is
// created, the question-writing call fails (venue wifi), she fixes the spelling
// and taps again. The slot already holds her row, so the create route used to
// answer "Slot 3 already has 'Ghost Storys', delete it first". A row with no
// questions has nothing to protect, so it simply takes the new topic and the
// screen carries on with the same category id.
//
// Only an EMPTY row qualifies: no question rows at all (so no picks either), in
// a game that is still in setup ('draft' / 'ready'), and in a pre-lock state
// ('draft', 'review', 'generating'). The caller has already checked that the
// host owns the game. Anything else keeps the protective message.
//
// Generation for the old topic may still be running (a 202 lost on bad wifi
// means a worker is writing questions about "Ghost Storys"). Every worker write
// is fenced on its job's `attempt` number (migration 0029): the question/photo/
// finish RPCs lock the job row and check the attempt, and the progress update
// is a compare-and-swap on the attempt. So the order here is:
//
//   1. Bump the job's attempt (compare-and-swap). From this moment every write
//      from the old worker is a no-op, and a write already in flight has to
//      commit before the bump can take the job row, so step 2 sees it.
//      The job row is kept, never deleted: a fresh row would restart at
//      attempt 1 and could match the old worker's number again.
//   2. Count question rows again. Anything the old worker saved before the
//      fence shows up here, and then the row keeps its topic.
//   3. Change topic + name and reset state to 'draft' (compare-and-swap on the
//      state and topic we saw), so the next generate call starts a new attempt
//      with the new topic.
//
// No new database function: this uses only tables and rules that already exist.

import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Category states an empty row can be in before it is locked. */
export const RETOPIC_CATEGORY_STATES: readonly string[] = ["draft", "review", "generating"];
/** Game states that are still setup. 'live' and 'done' never change. */
const SETUP_GAME_STATES: readonly string[] = ["draft", "ready"];

/** The board guard from 0031: game started (55000) or game row busy (55P03). */
const GAME_STARTED = "55000";
const GAME_BUSY = "55P03";

const UPDATE_TRIES = 3;
const UPDATE_RETRY_MS = 150;

export const SLOT_BUSY_MESSAGE =
  "That slot was being changed at the same moment. Tap again in a moment.";

export interface RetopicTarget {
  id: string;
  game_id: string;
  name: string;
  topic: string;
  position: number;
  state: string;
}

export interface RetopickedCategory {
  id: string;
  name: string;
  topic: string;
  position: number;
  state: string;
}

export type RetopicOutcome =
  /** The row now holds the new topic, state 'draft'. Same id. */
  | { kind: "retopicked"; category: RetopickedCategory }
  /** The row has questions, or is locked, or its game started: keep it as is. */
  | { kind: "keep" }
  /** Something else changed the row at the same moment. Nothing was renamed. */
  | { kind: "busy"; message: string }
  /** A read or write failed. Nothing was renamed. */
  | { kind: "error"; message: string };

interface PgError {
  code?: string;
  message?: string;
}

export async function retopicEmptyCategory(
  admin: Admin,
  target: RetopicTarget,
  input: { topic: string; name: string },
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RetopicOutcome> {
  if (!RETOPIC_CATEGORY_STATES.includes(target.state)) return { kind: "keep" };

  const { data: game, error: gameError } = await admin
    .from("games")
    .select("state")
    .eq("id", target.game_id)
    .maybeSingle();
  if (gameError) return { kind: "error", message: gameError.message };
  if (!game || !SETUP_GAME_STATES.includes((game as { state: string }).state)) {
    return { kind: "keep" };
  }

  // A row that already has questions keeps its topic. Checked before the fence
  // too, so the common "it has questions" case never pauses a running build.
  const before = await countQuestions(admin, target.id);
  if (!before.ok) return { kind: "error", message: before.message };
  if (before.count > 0) return { kind: "keep" };

  // 1. Fence any generation for the old topic.
  const { data: job, error: jobError } = await admin
    .from("question_generation_jobs")
    .select("attempt")
    .eq("category_id", target.id)
    .maybeSingle();
  if (jobError) return { kind: "error", message: jobError.message };
  if (job) {
    const attempt = (job as { attempt: number }).attempt;
    const nowIso = new Date().toISOString();
    const { data: bumped, error: bumpError } = await admin
      .from("question_generation_jobs")
      .update({
        attempt: attempt + 1,
        phase: "needs_attention",
        last_error: "The topic was changed.",
        heartbeat_at: nowIso,
        updated_at: nowIso,
      })
      .eq("category_id", target.id)
      .eq("attempt", attempt)
      .select("attempt")
      .maybeSingle();
    if (bumpError) return { kind: "error", message: bumpError.message };
    // Another attempt started between the read and the bump. Leave it alone.
    if (!bumped) return { kind: "busy", message: SLOT_BUSY_MESSAGE };
  }

  // 2. Anything the old worker saved before the fence is visible now.
  const after = await countQuestions(admin, target.id);
  if (!after.ok) return { kind: "error", message: after.message };
  if (after.count > 0) return { kind: "keep" };

  // 3. Take the new topic, only if the row is still exactly what we checked.
  for (let tryNo = 1; ; tryNo += 1) {
    const { data, error } = await admin
      .from("categories")
      .update({ topic: input.topic, name: input.name, state: "draft", flavor: null })
      .eq("id", target.id)
      .eq("state", target.state)
      .eq("topic", target.topic)
      .select("id, name, topic, position, state")
      .maybeSingle();
    if (!error) {
      if (!data) return { kind: "busy", message: SLOT_BUSY_MESSAGE };
      return { kind: "retopicked", category: data as RetopickedCategory };
    }
    const code = (error as PgError).code;
    if (code === GAME_STARTED) return { kind: "keep" };
    if (code === GAME_BUSY) {
      // Another category of this game is finishing and holds the game for a
      // moment. The fence above already stands, so trying again is safe.
      if (tryNo < UPDATE_TRIES) {
        await wait(UPDATE_RETRY_MS * tryNo);
        continue;
      }
      return { kind: "busy", message: SLOT_BUSY_MESSAGE };
    }
    return { kind: "error", message: (error as PgError).message ?? "could not change the topic" };
  }
}

async function countQuestions(
  admin: Admin,
  categoryId: string,
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const { count, error } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  if (error) return { ok: false, message: error.message };
  // No count back means we cannot prove the row is empty: treat it as filled.
  return { ok: true, count: typeof count === "number" ? count : 1 };
}

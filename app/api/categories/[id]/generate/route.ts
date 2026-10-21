// POST /api/categories/[id]/generate
//
// Kicks off the question-generation pipeline for a category:
//   1. Mark category.state = 'generating'
//   2. Return 202 immediately to the host UI
//   3. Schedule the background job via Next 16's `after()` — Claude writes
//      questions, every answer is fact-checked twice, and any rejected
//      question is refilled (up to 4 rounds) until 20 verified questions
//      exist; then each row gets a Pexels photo. A `progress` heartbeat is
//      broadcast on `category:{id}` every ~12s while writing/checking, then
//      `question_added` / `photo_attached` as rows land — for HostGenLoading.
//   4. On completion: category.state = 'review'. On a first-run failure the
//      certified checkpoint stays resumable; rerolls restore the prior review.
//
// Host-only. Body shape per lib/api/schemas.ts → GenerateCategoryBodySchema.

import { type NextRequest } from "next/server";
import { after } from "next/server";

import { requireOwnedCategory } from "@/lib/api/auth";
import {
  broadcastToCategory,
  type CategoryDonePayload,
  type CategoryProgressPayload,
  type GenerationPhase,
} from "@/lib/api/broadcast";
import { GenerateCategoryBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  paymentRequired,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { hostAIAccess } from "@/lib/api/entitlements";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { autoAttachPhoto } from "@/lib/ai/auto-attach-photo";
import {
  recordCategoryImageUrl,
  seedCategoryImageUrls,
} from "@/lib/ai/category-photo-plan";
import { generateQuestions, type GeneratedQuestion } from "@/lib/ai/generate-questions";
import { generateQuestionsNew } from "@/lib/ai/generate-questions-new";
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
  questionGenerationReportInsertFromSnapshot,
  type QuestionGenerationReportContext,
} from "@/lib/ai/question-generation-report";
import {
  beginQuestionGeneration,
  claimQuestionGenerationResume,
  commitGenerationPhoto,
  commitGenerationQuestions,
  completeQuestionGeneration,
  failQuestionGeneration,
  settleGenerationPhotoCommit,
  type GenerationRpcClient,
} from "@/lib/ai/generation-effects";
import { costUsd, type TokenUsage } from "@/lib/ai/usage-cost";
import { verifyAnswers } from "@/lib/ai/verify-answers";
import {
  classifyVerifiedQuestions,
  collectVerifiedQuestions,
} from "@/lib/ai/collect-verified-questions";
import {
  generationProgressFromRow,
  MIN_PLAYABLE_QUESTIONS,
  readGenerationJob,
  updateGenerationJob,
  updateGenerationJobForAttempt,
  type GenerationJobClient,
  type QuestionGenerationJobRow,
} from "@/lib/ai/generation-job";
import { createGenerationHeartbeat } from "@/lib/ai/generation-heartbeat";
import { readHostQuestionEngine, runWithQuestionEngine } from "@/lib/ai/question-engine";
import {
  createGenerationProgressReporter,
  writtenAfterBatch,
} from "@/lib/ai/generation-progress";
import { rerollPlan } from "@/lib/host/rerollPlan";
import {
  prepareQuestionAssignmentsForCategory,
  selectSpreadQuestionIds,
} from "@/lib/host/pickQuestions";
import { PexelsRateLimitError } from "@/lib/pexels/search";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generation now also runs an Opus verification pass (and may regenerate a
// round), so the background job needs more headroom than the old Haiku-only
// path. 800s is the most Vercel Pro allows (generally available; the 1800s
// option is a beta and not used). Classic still plans its work around 300s
// (PHOTO_STOP_AFTER_MS below), exactly as before; only the New engine plans
// around the longer limit (NEW_PHOTO_STOP_AFTER_MS and the New writer's own
// time cap).
export const maxDuration = 800;

// How often the background job emits a `progress` heartbeat while writing and
// fact-checking (before any question row exists). Comfortably under the
// client's idle timeout so a healthy-but-slow run never false-alarms, while a
// dead worker (no heartbeat) still trips it.
const GENERATION_HEARTBEAT_MS = 12_000;

// Vercel ends the whole request at maxDuration with no warning, and a slow
// writing step can use most of it. Photos are optional and are the last step,
// so once this much time has passed since the request began we stop adding
// more, save what the host has, and finish — instead of being cut off
// mid-photos with the build left unfinished. Leaves ~30s for the photo already
// in flight, the final save, and the "done" message.
//
// Classic's budget: unchanged from when the limit was 300s.
const PHOTO_STOP_AFTER_MS = 270_000;
// New's budget, 30s under the 800s limit. Its writer stops even earlier
// (NEW_WRITER_STOP_AFTER_MS, 660s, on this same clock) so its two checker
// passes and some photos still fit before this.
const NEW_PHOTO_STOP_AFTER_MS = 770_000;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // Vercel's time limit counts from when the request began.
  const startedAtMs = Date.now();
  const { id: categoryId } = await context.params;

  const owned = await requireOwnedCategory(categoryId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }
  const { category } = owned;

  // AI paywall gate — the single enforcement point for every lib/ai service,
  // since this route is the only server path into the generation pipeline.
  // Founder + comped (e.g. the founding customer's lifetime access) + active
  // free trial pass through; an ended/absent trial is blocked BEFORE we mark
  // the category generating or spend any AI/Pexels budget. 402 so the host UI
  // surfaces an upgrade message instead of a silent stall.
  if (!hostAIAccess(owned.host).allowed) {
    return paymentRequired(
      "Your free trial has ended. Upgrade to keep generating trivia with AI.",
    );
  }

  if (category.state === "ready") {
    return conflict("category already locked; reset to regenerate");
  }

  const admin = getSupabaseAdmin();
  const jobClient = admin as unknown as GenerationJobClient;
  const rpcClient = admin as unknown as GenerationRpcClient;
  let existingJob = null;
  if (category.state === "generating") {
    try {
      existingJob = await readGenerationJob(jobClient, categoryId);
    } catch {
      // If durable progress cannot prove the job stopped, the safest response
      // is still the existing duplicate-click guard—not a second AI worker.
      return conflict("already generating");
    }
    if (
      !existingJob ||
      generationProgressFromRow(existingJob).phase !== "needs_attention"
    ) {
      return conflict("already generating");
    }
  }

  const parsed = GenerateCategoryBodySchema.safeParse(await safeJson(req));
  if (!parsed.success) return badRequest(parsed.error);

  // A stopped first run is resumable: its certified rows stay in place and a
  // retry asks only for the missing choices. Every other generating state is
  // still a duplicate-click/race and remains blocked.
  const resume =
    category.state === "generating" &&
    existingJob !== null &&
    generationProgressFromRow(existingJob).phase === "needs_attention" &&
    !parsed.data.keptIds;
  if (category.state === "generating" && !resume) {
    return conflict("already generating");
  }

  let job: QuestionGenerationJobRow;
  // Only flavor + difficulty are persisted for "regenerate identically".
  // keptIds is per-reroll and must not pollute the stored flavor.
  const flavorJson: Json = JSON.parse(
    JSON.stringify({
      flavor: parsed.data.flavor,
      difficulty: parsed.data.difficulty,
    }),
  );
  try {
    if (resume) {
      const claimed = await claimQuestionGenerationResume(rpcClient, {
        categoryId,
        observedAttempt: existingJob!.attempt,
        observedPhase: existingJob!.phase,
        observedHeartbeatAt: existingJob!.heartbeat_at,
        flavor: flavorJson,
      });
      if (!claimed) return conflict("generation recovery already starting");
      job = claimed;
    } else {
      const begun = await beginQuestionGeneration(rpcClient, {
        categoryId,
        targetCount: 20,
        flavor: flavorJson,
      });
      if (!begun) return conflict("generation already starting");
      job = begun;
    }
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "could not start generation progress",
    );
  }

  // Read the topic again now that this attempt owns the job. The copy read at
  // the top of the request can be stale: a typo fix on the topic screen lets an
  // empty row take a new topic in place (POST /api/categories), and a slow or
  // retried request for the old words could otherwise begin after that and
  // write old-topic questions into the renamed row. A change made after this
  // read bumps the attempt, which fences this worker out instead.
  const { data: current, error: currentError } = await admin
    .from("categories")
    .select("name, topic")
    .eq("id", categoryId)
    .maybeSingle();
  if (currentError || !current) {
    try {
      await failQuestionGeneration(rpcClient, {
        categoryId,
        attempt: job.attempt,
        // A reroll goes back to its usable pool, as in the job's own failure path.
        restoreState: parsed.data.keptIds ? "review" : null,
        error: "The question builder could not start. Try again.",
      });
    } catch {
      /* best-effort: the job is resumable either way */
    }
    return serverError(currentError?.message ?? "category not found");
  }
  const { name: categoryName, topic } = current as { name: string; topic: string };

  // Fire-and-forget the background job. `after` runs once the response has
  // been flushed — the host UI sees the 202 immediately and then subscribes
  // to the category channel for progress events.
  const nightThemeKey = owned.night.theme_key;
  const reportContext: QuestionGenerationReportContext = {
    categoryId,
    gameId: category.game_id,
    nightId: owned.night.id,
    hostId: owned.host.id,
    categoryName,
    topic,
    mode: parsed.data.autoPick
      ? "auto_build"
      : parsed.data.keptIds
        ? "reroll"
        : "initial",
  };
  after(async () => {
    // Question engine switch: read the host's setting ONCE per build. Any
    // read problem (missing table on a preview, error, no row, unknown value)
    // means "classic". Both engines run the same build job; "new" only swaps
    // the question writer (step 4). Checker, photos and pick are shared.
    const questionEngine = await readHostQuestionEngine(admin, owned.host.id);
    console.log(
      `[generate] category=${categoryId} attempt=${job.attempt} questionEngine=${questionEngine}`,
    );
    await runWithQuestionEngine(
      questionEngine,
      {
        classic: runGenerationJob,
        // New: its own writer, given the request's start time for its total
        // time cap (NEW_WRITER_STOP_AFTER_MS), and the longer photo budget.
        new: (args) =>
          runGenerationJob({
            ...args,
            writeQuestions: (o) =>
              generateQuestionsNew({ ...o, startedAtMs: args.startedAtMs }),
            photoStopAfterMs: NEW_PHOTO_STOP_AFTER_MS,
          }),
      },
      {
        categoryId,
        topic,
        flavor: parsed.data.flavor,
        difficulty: parsed.data.difficulty,
        themeKey: isThemeKey(nightThemeKey) ? nightThemeKey : undefined,
        keptIds: parsed.data.keptIds,
        autoPick: parsed.data.autoPick,
        resume,
        attempt: job.attempt,
        startedAtMs,
        reportContext: { ...reportContext, questionEngine },
      },
    ).catch(async (err) => {
      if (err instanceof GenerationAttemptSupersededError) return;
      const internalMessage =
        err instanceof Error ? err.message : "unknown generation error";
      console.error("[generate] job failed:", internalMessage);
      const hostMessage = parsed.data.keptIds
        ? "Another set could not be finished. Your usable questions are still safe."
        : "The question builder paused before it finished.";

      // First-run failures remain resumable in `generating`: certified rows
      // are durable and the next click fills only the shortfall. Rerolls keep
      // their older atomic behavior because the host already has a complete,
      // usable pool and should stay on it.
      try {
        const applied = await failQuestionGeneration(rpcClient, {
          categoryId,
          attempt: job.attempt,
          restoreState: parsed.data.keptIds ? "review" : null,
          error: hostMessage,
        });
        if (!applied) return;
      } catch {
        /* best-effort */
        return;
      }
      try {
        await broadcastToCategory(categoryId, "error", {
          serverNow: new Date().toISOString(),
          attempt: job.attempt,
          error: hostMessage,
        });
      } catch {
        /* best-effort */
      }
    });
  });

  return ok({ status: "generating", categoryId, attempt: job.attempt }, 202);
}

async function safeJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    // Empty body is acceptable — schema's defaults make every field optional.
    return {};
  }
}

class GenerationAttemptSupersededError extends Error {}

/**
 * The actual generation pipeline. Runs after the HTTP response has flushed.
 * Order chosen so the host UI starts seeing question text as fast as
 * possible, then sees images backfill — keeps the wait feeling alive.
 */
async function runGenerationJob(opts: {
  categoryId: string;
  topic: string;
  flavor?: string[];
  difficulty?: "easy" | "normal" | "hard";
  themeKey?: ThemeKey;
  // Present ⇒ in-place reroll ("↻ Another 20"): keep these picked ids, avoid
  // repeating already-shown questions, and remove the unpicked candidates once
  // the fresh batch is in. Absent ⇒ first generation (append-only, nothing to
  // keep or delete).
  keptIds?: string[];
  // When true: after photos, auto-pick 7 (spread across difficulty) and flip
  // to 'ready' instead of 'review'. Founder build-a-full-game path.
  autoPick?: boolean;
  /** Resume a stopped first run from its already-certified question rows. */
  resume?: boolean;
  /** Durable fencing token returned by begin or the atomic resume claim. */
  attempt: number;
  /** When the request began (ms); Vercel's time limit counts from here. */
  startedAtMs: number;
  reportContext: QuestionGenerationReportContext;
  /** The question writer. Absent = Classic's generateQuestions. Only the
   *  "new" engine passes one (generateQuestionsNew). */
  writeQuestions?: typeof generateQuestions;
  /** Stop adding photos this long after the request began. Absent =
   *  Classic's PHOTO_STOP_AFTER_MS. Only the "new" engine passes one. */
  photoStopAfterMs?: number;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const jobClient = admin as unknown as GenerationJobClient;
  const rpcClient = admin as unknown as GenerationRpcClient;
  const qualityReport = createQuestionGenerationReportAccumulator({
    requestedCount: 20,
    verifyPasses: 2,
  });
  // Photos this attempt knows are already on its certified questions. The
  // database refuses a job row with more photos than certified questions. A
  // restart inherits the row of the run that was cut off, which may already say
  // "16 photos", while this attempt starts counting certified questions from
  // zero. So every write that sets the certified count also sets the photo
  // count, to a number this attempt can vouch for and never above it.
  let imageCount = 0;
  const writeWorkerProgress = async (
    patch: Parameters<typeof updateGenerationJob>[2],
  ) => {
    const consistent =
      patch.certified_count !== undefined && patch.image_count === undefined
        ? {
            ...patch,
            image_count: Math.min(imageCount, patch.certified_count),
          }
        : patch;
    const writeWon = await updateGenerationJobForAttempt(
      jobClient,
      opts.categoryId,
      opts.attempt,
      consistent,
    );
    if (!writeWon) throw new GenerationAttemptSupersededError();
  };
  const fenceSideEffect = async () => writeWorkerProgress({});

  // Reroll: gather what the host has already seen so we avoid repeats, and
  // remember which unpicked rows to remove once the fresh batch is inserted.
  let reroll: { deleteIds: string[]; avoidPrompts: string[] } | null = null;
  let existingCategoryImageUrls: Array<string | null> = [];
  if (opts.keptIds) {
    const { data: existing, error: existingError } = await admin
      .from("questions")
      .select("id, prompt, is_picked, image_url")
      .eq("category_id", opts.categoryId);
    // Surface the failure instead of degrading: if we can't read the current
    // pool, an `existing ?? []` would silently skip the swap + avoid-list and
    // reroll would append-with-repeats — the exact bug this fixes. Throwing
    // here runs the rollback before anything is generated or deleted.
    if (existingError) {
      throw new Error(`reroll: failed to load existing questions: ${existingError.message}`);
    }
    const plan = rerollPlan(existing ?? [], opts.keptIds);
    reroll = { deleteIds: plan.deleteIds, avoidPrompts: plan.avoidPrompts };
    existingCategoryImageUrls = (existing ?? []).map((row) => row.image_url);
  }

  // A first-run retry may contain rows certified by an older verifier. Load
  // them with their durable IDs/images, then re-certify below before treating
  // any as a safe checkpoint.
  const storedQuestions: Array<{
    id: string;
    q: GeneratedQuestion;
    imageUrl: string | null;
  }> = [];
  if (opts.resume && !opts.keptIds) {
    const { data, error } = await admin
      .from("questions")
      .select("id, prompt, options, correct_index, difficulty, fact_blurb, image_url, photo_query")
      .eq("category_id", opts.categoryId)
      .eq("source", "ai")
      .eq("is_picked", false);
    if (error) {
      throw new Error(`resume: failed to load certified questions: ${error.message}`);
    }
    for (const row of data ?? []) {
      if (!row.fact_blurb) {
        throw new Error("resume: a certified question is missing its fact note");
      }
      storedQuestions.push({
        id: row.id,
        q: {
          prompt: row.prompt,
          options: row.options as [string, string, string, string],
          correctIndex: row.correct_index as 0 | 1 | 2 | 3,
          difficulty: row.difficulty as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          factBlurb: row.fact_blurb,
          // Legacy rows predate photo_query; the category topic remains their
          // safe fallback while newer rows retain their specific visual intent.
          photoQuery: row.photo_query?.trim() || opts.topic,
        },
        imageUrl: row.image_url,
      });
    }
  }

  // Step 1: generate, then independently fact-check every answer on Opus —
  // TWICE (verifyPasses: 2), keeping only questions both passes agree are
  // correct AND unambiguous (a single check has wobble on borderline ones;
  // measured ~5% -> ~2.5% slip). A wrong/ambiguous answer can't reach a live
  // game. When the check rejects a question we REFILL it (maxRounds > 1): each
  // extra round asks only for the shortfall (`need`), avoiding prompts already
  // shown, until a full 20 verified questions exist — the host always gets a
  // complete, correct deck rather than a short one. Refill rounds are cheap
  // (top 19 -> 20 = one more question + its verify passes), so this stays well
  // inside maxDuration. Nothing is inserted or broadcast until it has passed —
  // the category is still 'generating', so the host never sees an unverified
  // question.
  //
  // Heartbeat: the generate -> verify -> refill run legitimately exceeds a
  // minute, and NOTHING is inserted (no question_added) until it finishes — so
  // without a steady signal the host's client-side safety timer false-alarms
  // ("took too long") even though the job is healthy. We tick a `progress`
  // broadcast every HEARTBEAT_MS carrying the current phase; the client arms
  // its timeout off the last heartbeat, so only a truly dead worker trips it.
  let phase: GenerationPhase = storedQuestions.length > 0 ? "checking" : "writing";
  let writtenCount = storedQuestions.length;
  let certifiedCount = 0;
  // Questions this build holds as clean, on every path. On a first build it
  // matches certifiedCount; on a reroll certifiedCount stays 0 until the
  // final swap, so the host's "Replacing N" and refill bar read this instead.
  let cleanCount = 0;
  const durableHeartbeat = createGenerationHeartbeat(() =>
    writeWorkerProgress({ phase }),
  );
  // Live counts: the writer streams "N written" and the checker reports each
  // finished chunk. The reporter throttles the durable `written_count` write
  // (one per 1.5s, latest value wins) and every progress broadcast carries
  // its counts, so the host sees real movement instead of a 90s freeze.
  // The throttled write is fenced like every other progress write: if this
  // attempt lost its row, remember it so live broadcasts stop at once instead
  // of a stale worker talking over the new attempt for a whole writer call.
  let liveProgressSuperseded = false;
  // Set once the build's live signals stop (success or failure). A verify
  // chunk still running after a sibling threw would otherwise broadcast a
  // late "checking" count over the error or the next attempt.
  let liveSignalsStopped = false;
  const liveProgress = createGenerationProgressReporter({
    target: 20,
    persistWritten: (written) =>
      writeWorkerProgress({ phase: "writing", written_count: written }).catch(
        (err: unknown) => {
          if (err instanceof GenerationAttemptSupersededError) {
            liveProgressSuperseded = true;
          }
          throw err;
        },
      ),
  });
  liveProgress.setCounts({ written: writtenCount, certified: certifiedCount });
  const broadcastProgress = () => {
    if (liveProgressSuperseded || liveSignalsStopped) {
      return Promise.resolve(undefined);
    }
    const payload: CategoryProgressPayload = {
      serverNow: new Date().toISOString(),
      phase,
      attempt: opts.attempt,
      ...liveProgress.counts(),
      // New thinks before it writes, so its writing step can run for
      // minutes; the host's screen says so. Classic never sends this.
      ...(opts.reportContext.questionEngine === "new" ? { longWrite: true } : {}),
    };
    return broadcastToCategory(opts.categoryId, "progress", payload).catch(
      () => undefined,
    );
  };
  // For the timed heartbeat only. A step that changes the phase writes the
  // row itself and then calls broadcastProgress() straight away: going
  // through the heartbeat wait first let the next step change `phase` before
  // the send, so a round end's "repairing" went out as "writing".
  const emitProgress = async () => {
    await durableHeartbeat.beat();
    return broadcastProgress();
  };
  const onWritten = (count: number) => {
    liveProgress.reportWritten(count);
    void broadcastProgress();
  };
  const onChecked = (checked: number, total: number, pass: 1 | 2) => {
    liveProgress.reportChecked(checked, total, pass);
    void broadcastProgress();
  };
  void emitProgress().catch(() => undefined);
  // Runs until the photo loop ends, not just until writing/checking ends:
  // photos can take 30s+ with only one signal per photo, and the host's
  // "Live" light counts on this beat (LIVE_WINDOW_MS in genProgress.ts).
  const heartbeat = setInterval(() => {
    void emitProgress().catch(() => undefined);
  }, GENERATION_HEARTBEAT_MS);
  const stopLiveSignals = async () => {
    liveSignalsStopped = true;
    clearInterval(heartbeat);
    await liveProgress.settle();
    await durableHeartbeat.drain();
  };

  // Accumulate real token spend across every generate + verify call this job
  // makes, so prod logs show the TRUE per-category cost — including refill
  // rounds and both verify passes, the things a clean benchmark misses.
  // Cost accounting only; never throws.
  const cost = { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 };
  const trackUsage = (model: string, u: TokenUsage) => {
    cost.usd += costUsd(model, u);
    cost.calls += 1;
    cost.tokensIn +=
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    cost.tokensOut += u.output_tokens ?? 0;
    qualityReport.recordUsage(model, u);
  };

  const insertedQuestions: typeof storedQuestions = [];
  const persistCertifiedBatch = async (batch: GeneratedQuestion[]) => {
    const persisted = await commitGenerationQuestions(rpcClient, {
      categoryId: opts.categoryId,
      attempt: opts.attempt,
      questions: batch,
      // Reroll replacement is one atomic effect: the complete fresh batch is
      // inserted before the old unpicked candidates disappear.
      deleteIds: opts.keptIds ? reroll?.deleteIds : undefined,
    });
    if (!persisted) throw new GenerationAttemptSupersededError();
    insertedQuestions.push(...persisted);
    for (const row of persisted) {
      await fenceSideEffect();
      await broadcastToCategory(opts.categoryId, "question_added", {
        serverNow: new Date().toISOString(),
        attempt: opts.attempt,
        questionId: row.id,
      }).catch(() => undefined);
    }
    certifiedCount += batch.length;
    cleanCount = Math.max(cleanCount, certifiedCount);
    // This runs at a round's end: say "repairing" now, so a heartbeat in
    // the gap before onRoundComplete can't send the new clean count under
    // the old "checking" phase.
    phase = certifiedCount >= 20 ? "images" : "repairing";
    liveProgress.setCounts({
      certified: certifiedCount,
      clean: cleanCount,
      written: Math.max(writtenCount, certifiedCount),
      // The clean count just moved, so the last round's failure number is
      // no longer the newest. Clearing it here (not when the first check
      // pass ends) keeps the headline steady through the whole check;
      // onRoundComplete sets this round's own number right after.
      failedLastRound: null,
    });
    await writeWorkerProgress({
      phase: certifiedCount >= 20 ? "images" : "repairing",
      certified_count: certifiedCount,
      written_count: Math.max(writtenCount, certifiedCount),
    });
  };

  let generated: GeneratedQuestion[];
  let inserted: Array<{
    id: string;
    prompt: string;
    q: GeneratedQuestion;
    imageUrl: string | null;
  }> = [];
  let autoPickAssignments: Array<{ id: string; pointValue: number }> | null = null;
  // Outer try: the heartbeat and live broadcasts run through writing,
  // checking AND photos, and stop on every exit (success or throw) before
  // the terminal write below.
  try {
    try {
      await writeWorkerProgress({
        phase,
        written_count: writtenCount,
        certified_count: certifiedCount,
      });
      const verifyCandidateBatch = async (
        questions: GeneratedQuestion[],
        passIndex: number,
        progress?: { onChecked: (checked: number, total: number) => void },
      ) => {
        phase = "checking";
        // Seed this pass at 0 so the bar's denominator (batch x 2 passes) is
        // set before the first chunk lands and never grows afterwards.
        liveProgress.reportChecked(0, questions.length, passIndex === 0 ? 1 : 2);
        await writeWorkerProgress({ phase: "checking" });
        void broadcastProgress();
        const verdicts = await verifyAnswers(questions, {
          topic: opts.topic,
          mode: passIndex === 0 ? "blind" : "adversarial",
          onUsage: trackUsage,
          onChunkChecked: (checked, total) => {
            if (progress) progress.onChecked(checked, total);
            else onChecked(checked, total, passIndex === 0 ? 1 : 2);
          },
        });
        return verdicts;
      };

      let certifiedStoredQuestions: typeof storedQuestions = [];
      let rejectedStoredPrompts: string[] = [];
      if (storedQuestions.length > 0) {
        const storedPassResults = await Promise.all(
          [0, 1].map((passIndex) =>
            verifyCandidateBatch(
              storedQuestions.map((item) => item.q),
              passIndex,
            ),
          ),
        );
        const storedClassification = classifyVerifiedQuestions(
          storedQuestions.map((item) => item.q),
          storedPassResults,
        );
        const acceptedStoredIndexes = new Set(
          storedClassification.acceptedIndexes,
        );
        certifiedStoredQuestions = storedQuestions.filter((_, index) =>
          acceptedStoredIndexes.has(index),
        );
        const rejectedStoredIds = storedClassification.rejected.map(
          ({ index }) => storedQuestions[index]!.id,
        );
        rejectedStoredPrompts = storedClassification.rejected.map(
          ({ prompt }) => prompt,
        );

        if (rejectedStoredIds.length > 0) {
          const deletion = await commitGenerationQuestions(rpcClient, {
            categoryId: opts.categoryId,
            attempt: opts.attempt,
            questions: [],
            deleteIds: rejectedStoredIds,
          });
          if (!deletion) throw new GenerationAttemptSupersededError();
        }
        insertedQuestions.push(...certifiedStoredQuestions);
        certifiedCount = certifiedStoredQuestions.length;
        imageCount = certifiedStoredQuestions.filter((item) =>
          Boolean(item.imageUrl),
        ).length;
        // Never lower the written count the host was shown: the rejected
        // stored questions were written, they just failed the re-check, and
        // the refill round below replaces them (its streamed count climbs
        // from certifiedCount, so it only moves this once it passes it).
        writtenCount = Math.max(writtenCount, certifiedCount);
        cleanCount = certifiedCount;
        liveProgress.setCounts({
          written: writtenCount,
          certified: certifiedCount,
          clean: cleanCount,
          // The host's "N failed the re-check" comes only from this.
          failedLastRound: rejectedStoredIds.length,
        });
        liveProgress.clearChecked();
        phase = certifiedCount >= 20 ? "images" : "repairing";
        qualityReport.recordRound({
          round: 0,
          requested: storedQuestions.length,
          generated: storedQuestions.length,
          accepted: certifiedStoredQuestions.length,
          rejected: storedClassification.rejected.map(({ prompt, reasons }) => ({
            prompt,
            reasons,
          })),
        });
        await writeWorkerProgress({
          phase,
          written_count: writtenCount,
          certified_count: certifiedCount,
        });
        // Broadcast right away: the host page refetches its cards on a
        // "repairing" progress event, so the stored questions just deleted
        // above leave the screen instead of inflating its count.
        void broadcastProgress();
      }

      generated = await collectVerifiedQuestions({
        target: 20,
        initialClean: certifiedStoredQuestions.map((item) => item.q),
        // Up to 4 rounds to top back up to 20. Almost always 1; an occasional
        // rejected question takes a cheap 2nd round. The bound caps worst-case
        // latency if the model keeps producing borderline answers.
        maxRounds: 4,
        verifyPasses: 2,
        generate: async (avoid, need, progress) => {
          phase = "writing";
          liveProgress.clearChecked();
          // collect holds exactly `20 - need` clean questions at this point.
          cleanCount = Math.max(0, 20 - need);
          liveProgress.setCounts({ clean: cleanCount });
          await writeWorkerProgress({ phase: "writing" });
          void broadcastProgress();
          let batch: GeneratedQuestion[];
          try {
            batch = await (opts.writeQuestions ?? generateQuestions)({
              topic: opts.topic,
              flavor: opts.flavor,
              difficulty: opts.difficulty,
              // Refill rounds request just the gap (+1 buffer to absorb a re-reject
              // without forcing yet another round), capped at the full target.
              count: Math.min(20, need + 1),
              themeKey: opts.themeKey,
              avoidPrompts: [
                ...(reroll?.avoidPrompts ?? []),
                ...rejectedStoredPrompts,
                ...avoid,
              ],
              onUsage: trackUsage,
              onRejectedCandidate: (event) => {
                qualityReport.recordInvalidCandidate(
                  event.prompt ?? `candidate ${event.index}`,
                  event.issues,
                );
              },
              onWritten: progress.onWritten,
            });
          } finally {
            // Stop any queued throttled write so it can't land after the
            // authoritative "checking" write below and flip the phase back.
            await liveProgress.settle();
          }
          // `20 - need` is what collect already holds as clean on EVERY path —
          // on a reroll `certifiedCount` stays 0 until the final atomic insert,
          // so using it here would drop the count after a refill round.
          //
          // Never lower it within this round, though: the stream already
          // counted questions the schema check then dropped (and the
          // max_tokens cut-off), so `batch.length` can be below what the host
          // was just shown. Those questions were written; they just failed
          // the format check, and the next refill round replaces them.
          writtenCount = writtenAfterBatch({
            shown: liveProgress.counts().written,
            need,
            batchLength: batch.length,
            target: 20,
          });
          liveProgress.setCounts({ written: writtenCount });
          phase = "checking";
          await writeWorkerProgress({
            phase: "checking",
            written_count: writtenCount,
          });
          void broadcastProgress();
          return batch;
        },
        verify: verifyCandidateBatch,
        onWritten,
        onChecked,
        onRoundComplete: async (event) => {
          qualityReport.recordRound({
            round: event.round,
            requested: event.requested,
            generated: event.generated,
            accepted: event.accepted,
            rejected: event.rejected.map((item) => ({
              prompt: item.prompt,
              reasons: item.reasons,
            })),
          });
          // Clean before this round, plus what it just accepted.
          cleanCount = Math.min(
            20,
            Math.max(0, 20 - event.requested) + event.accepted,
          );
          // The real number that failed this round's check. It rides on
          // every update until the next round ends, so the host can name it.
          liveProgress.setCounts({
            clean: cleanCount,
            failedLastRound: event.rejected.length,
          });
          if (certifiedCount < 20) {
            phase = "repairing";
            await writeWorkerProgress({
              phase: "repairing",
              written_count: writtenCount,
              certified_count: certifiedCount,
            });
            // Tell the host now (with the honest clean count) instead of
            // waiting up to one heartbeat.
            void broadcastProgress();
          }
        },
        // First runs checkpoint every certified batch. Rerolls remain atomic so
        // the host's complete current pool never mixes with a partial new one.
        onAccepted: opts.keptIds ? undefined : persistCertifiedBatch,
      });
    } finally {
      // Stop any queued throttled `written` write so it can't land after the
      // "images" phase write below and flip the phase back to writing.
      await liveProgress.settle();
    }
    console.log(
      `[generation-cost] category=${opts.categoryId} kept=${generated?.length ?? 0} ` +
        `llmCalls=${cost.calls} tokensIn=${cost.tokensIn} tokensOut=${cost.tokensOut} ` +
        `estUsd=${cost.usd.toFixed(4)}`,
    );
    if (generated.length < MIN_PLAYABLE_QUESTIONS) {
      throw new Error(
        `${MIN_PLAYABLE_QUESTIONS - generated.length} certified question choices are still needed`,
      );
    }
    qualityReport.recordAcceptedQuestions(generated);

    // Step 2: insert all rows up front so the UI can render them immediately.
    // Photos backfill afterwards.
    if (opts.keptIds) {
      await persistCertifiedBatch(generated);
    }
    inserted = insertedQuestions.map(({ id, q, imageUrl }) => ({
      id,
      prompt: q.prompt,
      q,
      imageUrl,
    }));
    const usedImageUrls = seedCategoryImageUrls([
      ...existingCategoryImageUrls,
      ...inserted.map((row) => row.imageUrl),
    ]);

    // Pick BEFORE photos on the auto-build path. The founder "build a full game"
    // tool keeps only 7 of the 20 generated questions, so photographing all 20
    // then discarding 13 does ~3x the Pexels work for nothing — and 12 categories
    // doing that at once overruns the rate limit (photos silently drop). Picking
    // first lets us fetch photos for just the 7 keepers: ~3x fewer lookups, under
    // the limit, and FASTER (less work, no added wait). Manual review still
    // photographs all 20 so the host's swap UI has the full pool.
    phase = "images";
    await writeWorkerProgress({
      phase: "images",
      certified_count: generated.length,
    });
    // Tell the host now: a build that ran out of rounds short of 20 would
    // otherwise keep saying "Writing N more", and a 20/20 build would sit
    // on "checking 40/40" until the next poll or heartbeat.
    void broadcastProgress();
    let photoTargets = inserted
      .filter((row) => !row.imageUrl)
      .map((row) => ({ id: row.id, q: row.q }));
    if (opts.autoPick) {
      const ids = selectSpreadQuestionIds(
        inserted.map((row) => ({
          id: row.id,
          difficulty: row.q.difficulty,
        })),
        7,
      );
      const result = await prepareQuestionAssignmentsForCategory(opts.categoryId, ids);
      if (!result.ok) {
        throw new Error(`auto-pick failed: ${result.error}`);
      }
      autoPickAssignments = result.picked;
      const keep = new Set(ids);
      photoTargets = photoTargets.filter((t) => keep.has(t.id));
    }
    qualityReport.recordImageTargets(photoTargets.length);

    // Step 3: attach photos. Sequential within a category because Pexels' free
    // tier is 200 req/hr — bursting risks brittleness without measurable
    // user-side latency benefit (the UI is already populated).
    imageCount = inserted.filter((row) => Boolean(row.imageUrl)).length;
    for (const { id, q } of photoTargets) {
      if (Date.now() - opts.startedAtMs > (opts.photoStopAfterMs ?? PHOTO_STOP_AFTER_MS)) {
        // Out of time. Photos are optional: keep the ones attached so far and
        // finish below rather than being cut off by the platform limit.
        console.warn("[generate] running out of time; stopping photo attach");
        break;
      }
      try {
        const photo = await autoAttachPhoto(q, {
          topic: opts.topic,
          excludeImageUrls: usedImageUrls,
        });
        const imageUrl = photo.imageUrl;
        if (imageUrl) {
          const outcome = await commitGenerationPhoto(rpcClient, {
            categoryId: opts.categoryId,
            attempt: opts.attempt,
            questionId: id,
            imageUrl,
            attribution: photo.attribution,
            source: "pexels",
          });
          const current = await settleGenerationPhotoCommit(outcome, {
            onApplied: async () => {
              recordCategoryImageUrl(usedImageUrls, imageUrl);
              qualityReport.recordImageAttached();
              imageCount += 1;
              await writeWorkerProgress({
                phase: "images",
                image_count: imageCount,
              });
            },
            fence: fenceSideEffect,
            broadcast: () =>
              broadcastToCategory(opts.categoryId, "photo_attached", {
                serverNow: new Date().toISOString(),
                attempt: opts.attempt,
                questionId: id,
                imageUrl,
                attribution: photo.attribution,
              }).catch(() => undefined),
          });
          if (!current) throw new GenerationAttemptSupersededError();
          continue;
        }
        await fenceSideEffect();
        await broadcastToCategory(opts.categoryId, "photo_attached", {
          serverNow: new Date().toISOString(),
          attempt: opts.attempt,
          questionId: id,
          imageUrl: photo.imageUrl,
          attribution: photo.attribution,
        }).catch(() => undefined);
      } catch (err) {
        if (err instanceof GenerationAttemptSupersededError) throw err;
        if (err instanceof PexelsRateLimitError) {
          // Don't blow up the whole batch — questions without images are
          // still usable. Stop attaching to avoid hammering Pexels further.
          console.warn("[generate] Pexels rate limited; stopping photo attach");
          break;
        }
        console.warn(
          "[generate] photo attach failed for question:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  } finally {
    await stopLiveSignals();
  }

  const reportSnapshot = qualityReport.snapshot(
    generated.length >= 20 ? "completed" : "partial",
  );
  const auditSummary = hostAuditSummaryFromSnapshot(reportSnapshot);
  const completed = await completeQuestionGeneration(rpcClient, {
    categoryId: opts.categoryId,
    attempt: opts.attempt,
    report: questionGenerationReportInsertFromSnapshot(
      opts.reportContext,
      reportSnapshot,
    ),
    assignments: autoPickAssignments,
    categoryState: opts.autoPick ? "ready" : "review",
    writtenCount: generated.length,
    certifiedCount: generated.length,
    imageCount,
  });
  if (!completed) throw new GenerationAttemptSupersededError();
  const donePayload: CategoryDonePayload = {
    serverNow: new Date().toISOString(),
    attempt: opts.attempt,
    count: inserted.length,
    auditSummary,
  };
  await fenceSideEffect();
  await broadcastToCategory(opts.categoryId, "done", donePayload).catch(
    () => undefined,
  );
}

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
//   4. On completion: category.state = 'review'. On failure: rolled back
//      to 'draft' and an `error` broadcast is sent.
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
  unauthorized,
} from "@/lib/api/responses";
import { hostAIAccess } from "@/lib/api/entitlements";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { autoAttachPhoto } from "@/lib/ai/auto-attach-photo";
import { generateQuestions, type GeneratedQuestion } from "@/lib/ai/generate-questions";
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
  questionGenerationReportInsertFromSnapshot,
  type QuestionGenerationReportContext,
} from "@/lib/ai/question-generation-report";
import { persistQuestionGenerationReport } from "@/lib/ai/question-generation-report-store";
import { costUsd, type TokenUsage } from "@/lib/ai/usage-cost";
import { verifyAnswers } from "@/lib/ai/verify-answers";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
import {
  beginGenerationJob,
  readGenerationJob,
  updateGenerationJob,
  type GenerationJobClient,
} from "@/lib/ai/generation-job";
import { rerollPlan } from "@/lib/host/rerollPlan";
import {
  pickQuestionsForCategory,
  selectSpreadQuestionIds,
} from "@/lib/host/pickQuestions";
import { PexelsRateLimitError } from "@/lib/pexels/search";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generation now also runs an Opus verification pass (and may regenerate a
// round), so the background job needs more headroom than the old Haiku-only
// path. 300s is Vercel's hard max on most plans.
export const maxDuration = 300;

// How often the background job emits a `progress` heartbeat while writing and
// fact-checking (before any question row exists). Comfortably under the
// client's idle timeout so a healthy-but-slow run never false-alarms, while a
// dead worker (no heartbeat) still trips it.
const GENERATION_HEARTBEAT_MS = 12_000;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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
  let existingJob = null;
  if (category.state === "generating") {
    try {
      existingJob = await readGenerationJob(jobClient, categoryId);
    } catch {
      // If durable progress cannot prove the job stopped, the safest response
      // is still the existing duplicate-click guard—not a second AI worker.
      return conflict("already generating");
    }
    if (existingJob?.phase !== "needs_attention") {
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
    existingJob?.phase === "needs_attention" &&
    !parsed.data.keptIds;
  if (category.state === "generating" && !resume) {
    return conflict("already generating");
  }

  try {
    await beginGenerationJob(jobClient, {
      categoryId,
      gameId: category.game_id,
      nightId: owned.night.id,
      hostId: owned.host.id,
      targetCount: 20,
      resume,
      existing: existingJob,
    });
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "could not start generation progress",
    );
  }

  // Mark generating + remember the flavor so we can regenerate identically.
  // The schema's strict shape -> Json roundtrip is safe (only strings + a
  // string-enum in the schema).
  // Only flavor + difficulty are persisted for "regenerate identically".
  // keptIds is per-reroll and must not pollute the stored flavor.
  const flavorJson: Json = JSON.parse(
    JSON.stringify({
      flavor: parsed.data.flavor,
      difficulty: parsed.data.difficulty,
    }),
  );
  const { error: updateError } = await admin
    .from("categories")
    .update({
      state: "generating",
      flavor: flavorJson,
    })
    .eq("id", categoryId);
  if (updateError) {
    return badRequest(`failed to start generation: ${updateError.message}`);
  }

  // Fire-and-forget the background job. `after` runs once the response has
  // been flushed — the host UI sees the 202 immediately and then subscribes
  // to the category channel for progress events.
  const nightThemeKey = owned.night.theme_key;
  const reportContext: QuestionGenerationReportContext = {
    categoryId,
    gameId: category.game_id,
    nightId: owned.night.id,
    hostId: owned.host.id,
    categoryName: category.name,
    topic: category.topic,
    mode: parsed.data.autoPick
      ? "auto_build"
      : parsed.data.keptIds
        ? "reroll"
        : "initial",
  };
  after(async () => {
    await runGenerationJob({
      categoryId,
      topic: category.topic,
      flavor: parsed.data.flavor,
      difficulty: parsed.data.difficulty,
      themeKey: isThemeKey(nightThemeKey) ? nightThemeKey : undefined,
      keptIds: parsed.data.keptIds,
      autoPick: parsed.data.autoPick,
      resume,
      reportContext,
    }).catch(async (err) => {
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
      if (parsed.data.keptIds) {
        try {
          await admin
            .from("categories")
            .update({ state: "review" })
            .eq("id", categoryId);
        } catch {
          /* best-effort */
        }
      }
      try {
        await updateGenerationJob(jobClient, categoryId, {
          phase: "needs_attention",
          last_error: hostMessage,
        });
      } catch {
        /* best-effort */
      }
      try {
        await broadcastToCategory(categoryId, "error", {
          serverNow: new Date().toISOString(),
          error: hostMessage,
        });
      } catch {
        /* best-effort */
      }
    });
  });

  return ok({ status: "generating", categoryId }, 202);
}

async function safeJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    // Empty body is acceptable — schema's defaults make every field optional.
    return {};
  }
}

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
  reportContext: QuestionGenerationReportContext;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const jobClient = admin as unknown as GenerationJobClient;
  const qualityReport = createQuestionGenerationReportAccumulator({
    requestedCount: 20,
    verifyPasses: 2,
  });

  // Reroll: gather what the host has already seen so we avoid repeats, and
  // remember which unpicked rows to remove once the fresh batch is inserted.
  let reroll: { deleteIds: string[]; avoidPrompts: string[] } | null = null;
  if (opts.keptIds) {
    const { data: existing, error: existingError } = await admin
      .from("questions")
      .select("id, prompt, is_picked")
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
  }

  // A first-run retry restores only questions that already passed every
  // certification gate. They are the durable checkpoint; generation asks for
  // the shortfall and never charges/waits for those choices twice.
  const storedQuestions: Array<{
    id: string;
    q: GeneratedQuestion;
    hasImage: boolean;
  }> = [];
  if (opts.resume && !opts.keptIds) {
    const { data, error } = await admin
      .from("questions")
      .select("id, prompt, options, correct_index, difficulty, fact_blurb, image_url")
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
          // Images are optional in Original mode; the topic is a safe fallback
          // query because the original generated query is not persisted.
          photoQuery: opts.topic,
        },
        hasImage: Boolean(row.image_url),
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
  let phase: GenerationPhase = "writing";
  let writtenCount = storedQuestions.length;
  let certifiedCount = storedQuestions.length;
  const emitProgress = () => {
    const payload: CategoryProgressPayload = {
      serverNow: new Date().toISOString(),
      phase,
    };
    return broadcastToCategory(opts.categoryId, "progress", payload).catch(
      () => undefined,
    );
  };
  void emitProgress();
  const heartbeat = setInterval(() => {
    void emitProgress();
    void updateGenerationJob(jobClient, opts.categoryId, { phase });
  }, GENERATION_HEARTBEAT_MS);

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

  const insertedQuestions = [...storedQuestions];
  const persistCertifiedBatch = async (batch: GeneratedQuestion[]) => {
    const insertRows = batch.map((q) => ({
      category_id: opts.categoryId,
      prompt: q.prompt,
      options: q.options as unknown as [string, string, string, string],
      correct_index: q.correctIndex,
      difficulty: q.difficulty,
      fact_blurb: q.factBlurb,
      source: "ai" as const,
      is_picked: false,
    }));
    const { data, error } = await admin
      .from("questions")
      .insert(insertRows)
      .select("id, prompt");
    if (error) throw new Error(`failed to save certified questions: ${error.message}`);
    if (!data || data.length !== batch.length) {
      throw new Error("certified question checkpoint returned an incomplete result");
    }
    for (let index = 0; index < data.length; index += 1) {
      insertedQuestions.push({
        id: data[index]!.id,
        q: batch[index]!,
        hasImage: false,
      });
      await broadcastToCategory(opts.categoryId, "question_added", {
        serverNow: new Date().toISOString(),
        questionId: data[index]!.id,
      }).catch(() => undefined);
    }
    certifiedCount += batch.length;
    await updateGenerationJob(jobClient, opts.categoryId, {
      phase: certifiedCount >= 20 ? "images" : "repairing",
      certified_count: certifiedCount,
      written_count: Math.max(writtenCount, certifiedCount),
    });
  };

  let generated: GeneratedQuestion[];
  try {
    await updateGenerationJob(jobClient, opts.categoryId, {
      phase: "writing",
      written_count: writtenCount,
      certified_count: certifiedCount,
    });
    generated = await collectVerifiedQuestions({
      target: 20,
      initialClean: storedQuestions.map((item) => item.q),
      // Up to 4 rounds to top back up to 20. Almost always 1; an occasional
      // rejected question takes a cheap 2nd round. The bound caps worst-case
      // latency if the model keeps producing borderline answers.
      maxRounds: 4,
      verifyPasses: 2,
      generate: async (avoid, need) => {
        phase = "writing";
        void emitProgress();
        await updateGenerationJob(jobClient, opts.categoryId, { phase: "writing" });
        const batch = await generateQuestions({
          topic: opts.topic,
          flavor: opts.flavor,
          difficulty: opts.difficulty,
          // Refill rounds request just the gap (+1 buffer to absorb a re-reject
          // without forcing yet another round), capped at the full target.
          count: Math.min(20, need + 1),
          themeKey: opts.themeKey,
          avoidPrompts: [...(reroll?.avoidPrompts ?? []), ...avoid],
          onUsage: trackUsage,
          onRejectedCandidate: (event) => {
            qualityReport.recordInvalidCandidate(
              event.prompt ?? `candidate ${event.index}`,
              event.issues,
            );
          },
        });
        writtenCount = Math.min(20, certifiedCount + batch.length);
        phase = "checking";
        await updateGenerationJob(jobClient, opts.categoryId, {
          phase: "checking",
          written_count: writtenCount,
        });
        void emitProgress();
        return batch;
      },
      verify: (qs) => {
        phase = "checking";
        void emitProgress();
        return verifyAnswers(qs, { onUsage: trackUsage });
      },
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
        if (certifiedCount < 20) {
          phase = "repairing";
          await updateGenerationJob(jobClient, opts.categoryId, {
            phase: "repairing",
            written_count: writtenCount,
            certified_count: certifiedCount,
          });
        }
      },
      // First runs checkpoint every certified batch. Rerolls remain atomic so
      // the host's complete current pool never mixes with a partial new one.
      onAccepted: opts.keptIds ? undefined : persistCertifiedBatch,
    });
  } finally {
    clearInterval(heartbeat);
  }
  console.log(
    `[generation-cost] category=${opts.categoryId} kept=${generated?.length ?? 0} ` +
      `llmCalls=${cost.calls} tokensIn=${cost.tokensIn} tokensOut=${cost.tokensOut} ` +
      `estUsd=${cost.usd.toFixed(4)}`,
  );
  if (generated.length < 20) {
    throw new Error(
      `${20 - generated.length} certified question choices are still needed`,
    );
  }
  qualityReport.recordAcceptedQuestions(generated);

  // Step 2: insert all rows up front so the UI can render them immediately.
  // Photos backfill afterwards.
  if (opts.keptIds) {
    await persistCertifiedBatch(generated);
  }
  const inserted = insertedQuestions.map(({ id, q, hasImage }) => ({
    id,
    prompt: q.prompt,
    q,
    hasImage,
  }));

  // Reroll cleanup: the fresh batch is safely inserted, so now remove the
  // previously-shown unpicked candidates. Picked rows were spared by the plan.
  // Generate-first ordering guarantees a generation/insert failure never
  // empties the pool. Non-fatal if it fails — worst case the old pile lingers.
  if (reroll && reroll.deleteIds.length > 0) {
    const { error: cleanupError } = await admin
      .from("questions")
      .delete()
      .eq("category_id", opts.categoryId)
      .in("id", reroll.deleteIds);
    if (cleanupError) {
      console.warn("[generate] reroll cleanup failed:", cleanupError.message);
    }
  }

  // Pick BEFORE photos on the auto-build path. The founder "build a full game"
  // tool keeps only 7 of the 20 generated questions, so photographing all 20
  // then discarding 13 does ~3x the Pexels work for nothing — and 12 categories
  // doing that at once overruns the rate limit (photos silently drop). Picking
  // first lets us fetch photos for just the 7 keepers: ~3x fewer lookups, under
  // the limit, and FASTER (less work, no added wait). Manual review still
  // photographs all 20 so the host's swap UI has the full pool.
  phase = "images";
  await updateGenerationJob(jobClient, opts.categoryId, {
    phase: "images",
    certified_count: generated.length,
  });
  let photoTargets = inserted
    .filter((row) => !row.hasImage)
    .map((row) => ({ id: row.id, q: row.q }));
  if (opts.autoPick) {
    const ids = selectSpreadQuestionIds(
      inserted.map((row) => ({
        id: row.id,
        difficulty: row.q.difficulty,
      })),
      7,
    );
    const result = await pickQuestionsForCategory(opts.categoryId, ids);
    if (!result.ok) {
      throw new Error(`auto-pick failed: ${result.error}`);
    }
    const keep = new Set(ids);
    photoTargets = photoTargets.filter((t) => keep.has(t.id));
  }
  qualityReport.recordImageTargets(photoTargets.length);

  // Step 3: attach photos. Sequential within a category because Pexels' free
  // tier is 200 req/hr — bursting risks brittleness without measurable
  // user-side latency benefit (the UI is already populated).
  let imageCount = inserted.filter((row) => row.hasImage).length;
  for (const { id, q } of photoTargets) {
    try {
      const photo = await autoAttachPhoto(q, { topic: opts.topic });
      if (photo.imageUrl) {
        const { error: photoUpdateError } = await admin
          .from("questions")
          .update({
            image_url: photo.imageUrl,
            image_attribution: photo.attribution,
            image_source: "pexels",
          })
          .eq("id", id);
        if (photoUpdateError) {
          console.warn(
            "[generate] photo update failed for question:",
            photoUpdateError.message,
          );
        } else {
          qualityReport.recordImageAttached();
          imageCount += 1;
          await updateGenerationJob(jobClient, opts.categoryId, {
            phase: "images",
            image_count: imageCount,
          });
        }
      }
      await broadcastToCategory(opts.categoryId, "photo_attached", {
        serverNow: new Date().toISOString(),
        questionId: id,
        imageUrl: photo.imageUrl,
        attribution: photo.attribution,
      }).catch(() => undefined);
    } catch (err) {
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

  const reportSnapshot = qualityReport.snapshot(
    generated.length >= 20 ? "completed" : "partial",
  );
  const auditSummary = hostAuditSummaryFromSnapshot(reportSnapshot);
  await persistQuestionGenerationReport(
    admin,
    questionGenerationReportInsertFromSnapshot(opts.reportContext, reportSnapshot),
  );

  // Step 4: finalize state. The auto-build is already 'ready' (picked above);
  // manual review stops at 'review' for the host to curate. Persist the report
  // first so DB-poll fallback can't observe review before the summary exists.
  if (!opts.autoPick) {
    await admin
      .from("categories")
      .update({ state: "review" })
      .eq("id", opts.categoryId);
  }
  await updateGenerationJob(jobClient, opts.categoryId, {
    phase: "ready",
    written_count: 20,
    certified_count: 20,
    image_count: imageCount,
    last_error: null,
  });
  const donePayload: CategoryDonePayload = {
    serverNow: new Date().toISOString(),
    count: inserted.length,
    auditSummary,
  };
  await broadcastToCategory(opts.categoryId, "done", donePayload).catch(
    () => undefined,
  );
}

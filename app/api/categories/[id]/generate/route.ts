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
import { verifyAnswers } from "@/lib/ai/verify-answers";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
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

  // Idempotency / race guard: refuse if the category is mid-generation or
  // already complete. Host can re-run from 'draft' or 'review' (regenerate).
  if (category.state === "generating") {
    return conflict("already generating");
  }
  if (category.state === "ready") {
    return conflict("category already locked; reset to regenerate");
  }

  const parsed = GenerateCategoryBodySchema.safeParse(await safeJson(req));
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

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
  after(async () => {
    await runGenerationJob({
      categoryId,
      topic: category.topic,
      flavor: parsed.data.flavor,
      difficulty: parsed.data.difficulty,
      themeKey: isThemeKey(nightThemeKey) ? nightThemeKey : undefined,
      keptIds: parsed.data.keptIds,
      autoPick: parsed.data.autoPick,
    }).catch(async (err) => {
      // Rollback + broadcast on any unexpected failure inside the job.
      // (Per-question failures are handled inside runGenerationJob.)
      const message =
        err instanceof Error ? err.message : "unknown generation error";
      console.error("[generate] job failed:", message);
      // First-gen failure rolls back to 'draft' (no questions exist yet). A
      // reroll (keptIds present) failed from 'review' with the host's pool +
      // picks intact — generate-first ordering means nothing was deleted — so
      // restore 'review', not 'draft', or a hard reload would look empty.
      const rollbackState = parsed.data.keptIds ? "review" : "draft";
      try {
        await admin
          .from("categories")
          .update({ state: rollbackState })
          .eq("id", categoryId);
      } catch {
        /* best-effort */
      }
      try {
        await broadcastToCategory(categoryId, "error", {
          serverNow: new Date().toISOString(),
          error: message,
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
}): Promise<void> {
  const admin = getSupabaseAdmin();

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
  }, GENERATION_HEARTBEAT_MS);

  let generated: GeneratedQuestion[];
  try {
    generated = await collectVerifiedQuestions({
      target: 20,
      // Up to 4 rounds to top back up to 20. Almost always 1; an occasional
      // rejected question takes a cheap 2nd round. The bound caps worst-case
      // latency if the model keeps producing borderline answers.
      maxRounds: 4,
      verifyPasses: 2,
      generate: (avoid, need) => {
        phase = "writing";
        void emitProgress();
        return generateQuestions({
          topic: opts.topic,
          flavor: opts.flavor,
          difficulty: opts.difficulty,
          // Refill rounds request just the gap (+1 buffer to absorb a re-reject
          // without forcing yet another round), capped at the full target.
          count: Math.min(20, need + 1),
          themeKey: opts.themeKey,
          avoidPrompts: [...(reroll?.avoidPrompts ?? []), ...avoid],
        });
      },
      verify: (qs) => {
        phase = "checking";
        void emitProgress();
        return verifyAnswers(qs);
      },
    });
  } finally {
    clearInterval(heartbeat);
  }
  if (generated.length === 0) {
    throw new Error("no questions passed the answer check");
  }

  // Step 2: insert all rows up front so the UI can render them immediately.
  // Photos backfill afterwards.
  const insertRows = generated.map((q) => ({
    category_id: opts.categoryId,
    prompt: q.prompt,
    options: q.options as unknown as [string, string, string, string],
    correct_index: q.correctIndex,
    difficulty: q.difficulty,
    fact_blurb: q.factBlurb,
    source: "ai" as const,
    is_picked: false,
  }));
  const { data: inserted, error: insertError } = await admin
    .from("questions")
    .insert(insertRows)
    .select("id, prompt");
  if (insertError) {
    throw new Error(`failed to insert questions: ${insertError.message}`);
  }
  if (!inserted) {
    throw new Error("insert returned no rows");
  }

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

  // Broadcast question_added for each row so HostGenLoading can populate.
  for (const row of inserted) {
    await broadcastToCategory(opts.categoryId, "question_added", {
      serverNow: new Date().toISOString(),
      questionId: row.id,
    }).catch(() => undefined);
  }

  // Pick BEFORE photos on the auto-build path. The founder "build a full game"
  // tool keeps only 7 of the 20 generated questions, so photographing all 20
  // then discarding 13 does ~3x the Pexels work for nothing — and 12 categories
  // doing that at once overruns the rate limit (photos silently drop). Picking
  // first lets us fetch photos for just the 7 keepers: ~3x fewer lookups, under
  // the limit, and FASTER (less work, no added wait). Manual review still
  // photographs all 20 so the host's swap UI has the full pool.
  let photoTargets = inserted.map((row, i) => ({ id: row.id, q: generated[i]! }));
  if (opts.autoPick) {
    const ids = selectSpreadQuestionIds(
      inserted.map((row, i) => ({
        id: row.id,
        difficulty: generated[i]!.difficulty,
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

  // Step 3: attach photos. Sequential within a category because Pexels' free
  // tier is 200 req/hr — bursting risks brittleness without measurable
  // user-side latency benefit (the UI is already populated).
  for (const { id, q } of photoTargets) {
    try {
      const photo = await autoAttachPhoto(q, { topic: opts.topic });
      if (photo.imageUrl) {
        await admin
          .from("questions")
          .update({
            image_url: photo.imageUrl,
            image_attribution: photo.attribution,
            image_source: "pexels",
          })
          .eq("id", id);
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

  // Step 4: finalize state. The auto-build is already 'ready' (picked above);
  // manual review stops at 'review' for the host to curate.
  if (!opts.autoPick) {
    await admin
      .from("categories")
      .update({ state: "review" })
      .eq("id", opts.categoryId);
  }
  await broadcastToCategory(opts.categoryId, "done", {
    serverNow: new Date().toISOString(),
    count: inserted.length,
  }).catch(() => undefined);
}

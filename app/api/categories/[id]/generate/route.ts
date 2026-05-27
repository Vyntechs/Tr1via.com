// POST /api/categories/[id]/generate
//
// Kicks off the question-generation pipeline for a category:
//   1. Mark category.state = 'generating'
//   2. Return 202 immediately to the host UI
//   3. Schedule the background job via Next 16's `after()` — Claude
//      generates 20 questions, each row gets a Pexels photo, progress is
//      broadcast on `category:{id}` for the HostGenLoading screen.
//   4. On completion: category.state = 'review'. On failure: rolled back
//      to 'draft' and an `error` broadcast is sent.
//
// Host-only. Body shape per lib/api/schemas.ts → GenerateCategoryBodySchema.

import { type NextRequest } from "next/server";
import { after } from "next/server";

import { requireOwnedCategory } from "@/lib/api/auth";
import { broadcastToCategory } from "@/lib/api/broadcast";
import { GenerateCategoryBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { autoAttachPhoto } from "@/lib/ai/auto-attach-photo";
import { generateQuestions } from "@/lib/ai/generate-questions";
import { PexelsRateLimitError } from "@/lib/pexels/search";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The background `after()` job runs within the function's lifetime. Real
// Anthropic (Haiku) is ~20s and Pexels photo attach across 20 questions
// adds another ~30-40s — well over Vercel's default per-function ceiling.
// 300s is Vercel's hard max on most plans; we use 120 for headroom.
export const maxDuration = 120;

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
  const flavorJson: Json = JSON.parse(JSON.stringify(parsed.data));
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
    }).catch(async (err) => {
      // Rollback + broadcast on any unexpected failure inside the job.
      // (Per-question failures are handled inside runGenerationJob.)
      const message =
        err instanceof Error ? err.message : "unknown generation error";
      console.error("[generate] job failed:", message);
      try {
        await admin
          .from("categories")
          .update({ state: "draft" })
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
}): Promise<void> {
  const admin = getSupabaseAdmin();

  // Step 1: ask Claude for the batch. ~3-8s typical.
  const generated = await generateQuestions({
    topic: opts.topic,
    flavor: opts.flavor,
    difficulty: opts.difficulty,
    count: 20,
    themeKey: opts.themeKey,
  });
  if (generated.length === 0) {
    throw new Error("Claude returned zero valid questions");
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

  // Broadcast question_added for each row so HostGenLoading can populate.
  for (const row of inserted) {
    await broadcastToCategory(opts.categoryId, "question_added", {
      serverNow: new Date().toISOString(),
      questionId: row.id,
    }).catch(() => undefined);
  }

  // Step 3: attach photos. We do these sequentially because Pexels' free
  // tier is 200 req/hr — bursting 20 in parallel risks brittleness without
  // measurable user-side latency benefit (the UI is already populated).
  for (let i = 0; i < inserted.length; i++) {
    const row = inserted[i];
    const q = generated[i];
    if (!row || !q) continue;
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
          .eq("id", row.id);
      }
      await broadcastToCategory(opts.categoryId, "photo_attached", {
        serverNow: new Date().toISOString(),
        questionId: row.id,
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

  // Step 4: flip the category to review and announce done.
  await admin
    .from("categories")
    .update({ state: "review" })
    .eq("id", opts.categoryId);
  await broadcastToCategory(opts.categoryId, "done", {
    serverNow: new Date().toISOString(),
    count: inserted.length,
  }).catch(() => undefined);
}

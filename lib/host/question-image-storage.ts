import "server-only";

import type { getSupabaseAdmin } from "@/lib/supabase/admin";

export const QUESTION_IMAGE_BUCKET = "question-images";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export interface QuestionImagePredecessor {
  imageUrl: string | null;
  imageSource: string | null;
}

export type QuestionImageUpdate = {
  image_url: string | null;
  image_attribution: string | null;
  image_source: string | null;
};

export type QuestionImageCasResult =
  | {
      status: "applied";
      question: {
        id: string;
        image_url: string | null;
        image_attribution: string | null;
        image_source: string | null;
      };
    }
  | { status: "conflict" }
  | { status: "error"; error: string };

/**
 * Update a question image only if both authority fields still match the row
 * read during ownership validation. Postgres rechecks these predicates after
 * any concurrent row lock is released, so a delayed request cannot overwrite
 * a newer host choice.
 */
export async function compareAndSetQuestionImage(
  admin: AdminClient,
  input: {
    questionId: string;
    predecessor: QuestionImagePredecessor;
    update: QuestionImageUpdate;
  },
): Promise<QuestionImageCasResult> {
  const base = admin
    .from("questions")
    .update(input.update)
    .eq("id", input.questionId);
  const byUrl =
    input.predecessor.imageUrl === null
      ? base.is("image_url", null)
      : base.eq("image_url", input.predecessor.imageUrl);
  const bySource =
    input.predecessor.imageSource === null
      ? byUrl.is("image_source", null)
      : byUrl.eq("image_source", input.predecessor.imageSource);
  const { data, error } = await bySource
    .select("id, image_url, image_attribution, image_source")
    .maybeSingle();

  if (error) return { status: "error", error: error.message };
  if (!data) return { status: "conflict" };
  return { status: "applied", question: data };
}

export function parseOwnedQuestionImagePath(input: {
  publicUrl: string;
  supabaseUrl: string | undefined;
  nightId: string;
  questionId: string;
}): string | null {
  const base = questionImagePublicBase(input.supabaseUrl);
  if (!base || !input.publicUrl.startsWith(base)) return null;

  let parsed: URL;
  try {
    parsed = new URL(input.publicUrl);
  } catch {
    return null;
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    return null;
  }
  if (parsed.origin !== new URL(base).origin) return null;

  const rawSegments = input.publicUrl.slice(base.length).split("/");
  if (rawSegments.length !== 2 && rawSegments.length !== 3) return null;
  const segments: string[] = [];
  for (const raw of rawSegments) {
    if (!raw) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (decoded === "." || decoded === ".." || /[\\/]/.test(decoded)) {
      return null;
    }
    segments.push(decoded);
  }

  if (segments[0] !== input.nightId) return null;
  const extension = "(?:png|jpg|webp|gif)";
  if (segments.length === 2) {
    const legacyName = new RegExp(
      `^${escapeRegExp(input.questionId)}\\.${extension}$`,
    );
    if (!legacyName.test(segments[1]!)) {
      return null;
    }
  } else {
    if (segments[1] !== input.questionId) return null;
    const versionedName = new RegExp(
      `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${extension}$`,
      "i",
    );
    if (!versionedName.test(segments[2]!)) {
      return null;
    }
  }
  return segments.join("/");
}

/** Best-effort compensation for a new object whose database CAS did not win. */
export async function removeNewQuestionImageUpload(
  admin: AdminClient,
  key: string,
): Promise<void> {
  try {
    const { error } = await admin.storage
      .from(QUESTION_IMAGE_BUCKET)
      .remove([key]);
    if (error) warnCleanup("new upload", error);
  } catch (error) {
    warnCleanup("new upload", error);
  }
}

/**
 * Best-effort removal of the immediate predecessor after a successful CAS.
 * Parsing and the cross-row reference check both fail closed.
 */
export async function cleanupReplacedQuestionUpload(
  admin: AdminClient,
  input: {
    nightId: string;
    questionId: string;
    predecessor: QuestionImagePredecessor;
    replacementUrl: string | null;
  },
): Promise<void> {
  const oldUrl = input.predecessor.imageUrl;
  if (
    input.predecessor.imageSource !== "upload" ||
    !oldUrl ||
    oldUrl === input.replacementUrl
  ) {
    return;
  }
  const path = parseOwnedQuestionImagePath({
    publicUrl: oldUrl,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    nightId: input.nightId,
    questionId: input.questionId,
  });
  if (!path) return;

  try {
    const { data: shared, error: referenceError } = await admin
      .from("questions")
      .select("id")
      .eq("image_url", oldUrl)
      .neq("id", input.questionId)
      .limit(1)
      .maybeSingle();
    if (referenceError) {
      warnCleanup("reference check", referenceError);
      return;
    }
    if (shared) return;

    const { error: removeError } = await admin.storage
      .from(QUESTION_IMAGE_BUCKET)
      .remove([path]);
    if (removeError) warnCleanup("predecessor", removeError);
  } catch (error) {
    warnCleanup("predecessor", error);
  }
}

function questionImagePublicBase(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const configured = new URL(supabaseUrl);
    if (!/^https?:$/.test(configured.protocol)) return null;
    if (
      configured.search ||
      configured.hash ||
      configured.username ||
      configured.password
    ) {
      return null;
    }
    return `${configured.href.replace(/\/$/, "")}/storage/v1/object/public/${QUESTION_IMAGE_BUCKET}/`;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function warnCleanup(stage: string, error: unknown) {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : String(error);
  console.warn(
    `[question-image cleanup] ${stage}: ${detail.replace(/\s+/g, " ").slice(0, 180)}`,
  );
}

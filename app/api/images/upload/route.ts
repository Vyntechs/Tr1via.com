// POST /api/images/upload  (multipart/form-data)
//
// The host's manual image-upload path for a question (HostGenImageUpload):
//   - Form field `file`:        the image
//   - Form field `questionId`:  which question this image belongs to
//
// Validation:
//   - MIME via the request part header + magic-byte sniff (we don't trust
//     the client header alone)
//   - Size ≤ 10 MB
//   - Allowed types: png, jpeg, webp, gif
//   - File extension is derived from the magic bytes, not the filename —
//     prevents path-traversal or sneaky extensions
//
// Storage:
//   bucket  = "question-images"
//   key     = "{nightId}/{questionId}.{ext}"
//   public  = yes (the bucket is configured public-read in
//             supabase/migrations/0004_storage.sql)
//
// The question's `image_url`, `image_attribution=null`, and
// `image_source='upload'` are set on success.

import { type NextRequest } from "next/server";

import { requireOwnedQuestion } from "@/lib/api/auth";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = "question-images";

interface ImageType {
  ext: "png" | "jpg" | "webp" | "gif";
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("expected multipart/form-data");
  }

  const file = formData.get("file");
  const questionIdRaw = formData.get("questionId");

  if (!(file instanceof File)) {
    return badRequest("missing `file`");
  }
  if (typeof questionIdRaw !== "string" || questionIdRaw.length === 0) {
    return badRequest("missing `questionId`");
  }

  if (file.size === 0) return badRequest("empty file");
  if (file.size > MAX_BYTES) {
    return badRequest(`file too large (max ${MAX_BYTES} bytes)`);
  }

  const owned = await requireOwnedQuestion(questionIdRaw);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }
  const { night, question } = owned;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return badRequest("file is not a supported image (png, jpeg, webp, gif)");
  }
  // Belt-and-braces: if the client-declared MIME disagrees with the magic
  // bytes, prefer the magic bytes. We log but don't reject — older
  // browsers sometimes send octet-stream on drag-drop.
  if (file.type && !file.type.startsWith("image/")) {
    console.warn(
      `[images/upload] client claimed non-image MIME '${file.type}'; trusting magic bytes ${detected.mime}`,
    );
  }

  const key = `${night.id}/${question.id}.${detected.ext}`;
  const admin = getSupabaseAdmin();

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(key, bytes, {
      contentType: detected.mime,
      upsert: true,
      cacheControl: "3600",
    });
  if (uploadError) {
    return serverError(`storage upload failed: ${uploadError.message}`);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(key);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) {
    return serverError("failed to resolve public URL for uploaded image");
  }

  const { data: updated, error: updateError } = await admin
    .from("questions")
    .update({
      image_url: publicUrl,
      image_attribution: null,
      image_source: "upload",
    })
    .eq("id", question.id)
    .select("id, image_url, image_source")
    .single();
  if (updateError || !updated) {
    return serverError(
      `failed to update question: ${updateError?.message ?? "unknown"}`,
    );
  }

  return ok({ question: updated });
}

/**
 * Sniff the leading bytes of the file to determine the real image type.
 *
 * Magic byte references:
 *   PNG:  89 50 4E 47 0D 0A 1A 0A
 *   JPEG: FF D8 FF
 *   GIF:  47 49 46 38 (37|39) 61
 *   WEBP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  ("RIFF....WEBP")
 *
 * Returning null for an unknown format keeps the caller's reject branch
 * simple.
 */
function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;

  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  // GIF
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { ext: "gif", mime: "image/gif" };
  }

  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }

  return null;
}

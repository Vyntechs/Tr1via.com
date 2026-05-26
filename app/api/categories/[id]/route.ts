// PATCH /api/categories/:id — host renames the category's display label.
//
// Body: { name: string (1..80, trimmed) }. The rename only touches
// `categories.name`. `categories.topic` (the original Claude prompt) is
// preserved so we don't accidentally invalidate the 20 generated
// candidates or shift the Pexels seed for the question images.
//
// Allowed at any category state — `draft`, `generating`, `review`,
// `ready`. Renaming a locked category is the entire point of the
// feature (Heather: "I just want it to say skirts"); there's no
// invariant a rename can break.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { requireOwnedCategory } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PatchCategoryBodySchema } from "@/lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const owned = await requireOwnedCategory(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let parsed: z.infer<typeof PatchCategoryBodySchema>;
  try {
    parsed = PatchCategoryBodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest(err);
    return badRequest(err instanceof Error ? err.message : "invalid body");
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("categories")
    .update({ name: parsed.name })
    .eq("id", id)
    .select("id, name")
    .single();
  if (error || !data) {
    return serverError(error?.message ?? "could not rename category");
  }

  return ok({ category: { id: data.id, name: data.name } });
}

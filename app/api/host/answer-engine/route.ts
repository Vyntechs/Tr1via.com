import { z } from "zod";

import { badRequest, forbidden, ok, serverError, unauthorized } from "@/lib/api/responses";
import { getAuthedHost } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const PreferenceSchema = z.object({
  preferredEngine: z.enum(["legacy", "resilient_v1"]),
}).strict();

export async function GET() {
  const auth = await getAuthedHost();
  if (!auth.ok) {
    return auth.status === 401
      ? unauthorized(auth.error)
      : forbidden(auth.error);
  }

  const admin = getSupabaseAdmin();
  const { data: setting, error } = await admin
    .from("host_answer_engine_settings")
    .select("release_enabled, preferred_engine")
    .eq("host_id", auth.host.id)
    .maybeSingle();
  if (error) return serverError("could not read answer engine preference");
  if (!setting?.release_enabled) {
    return forbidden("answer engine release is not enabled for this host");
  }
  return ok({ preferredEngine: setting.preferred_engine });
}

export async function POST(req: Request) {
  const auth = await getAuthedHost();
  if (!auth.ok) {
    return auth.status === 401
      ? unauthorized(auth.error)
      : forbidden(auth.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = PreferenceSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();
  const { data: setting, error: settingError } = await admin
    .from("host_answer_engine_settings")
    .select("release_enabled, preferred_engine")
    .eq("host_id", auth.host.id)
    .maybeSingle();
  if (settingError) return serverError("could not update answer engine preference");
  if (!setting?.release_enabled) {
    return forbidden("answer engine release is not enabled for this host");
  }

  const { data, error } = await admin
    .from("host_answer_engine_settings")
    .update({
      preferred_engine: parsed.data.preferredEngine,
      updated_at: new Date().toISOString(),
    })
    .eq("host_id", auth.host.id)
    .select("preferred_engine")
    .single();
  if (error || !data) return serverError("could not update answer engine preference");

  return ok({ preferredEngine: data.preferred_engine });
}

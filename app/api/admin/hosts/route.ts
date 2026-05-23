// /api/admin/hosts — founder-only host management.
//
// GET  → list every host in the DB, joined with auth.users for email +
//        sorted newest-first. Used by /host/admin to render the table.
// POST → "comp a host": create their auth.users row (with email_confirm
//        so the magic-link flow works immediately) and their hosts row
//        with is_paywall_bypassed=true + audit fields. They land in the
//        DB as an already-comped host; next time they hit /login and
//        type their email, the magic-link flow signs them in.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  badRequest,
  forbidden,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";

export interface AdminHostRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  default_venue: string | null;
  role: "host" | "founder";
  is_paywall_bypassed: boolean;
  comped_at: string | null;
  comped_by: string | null;
  comped_by_name: string | null;
  created_at: string;
}

export async function GET() {
  const auth = await requireFounder();
  if (!auth.ok) {
    if (auth.status === 401) return unauthorized(auth.error);
    return forbidden(auth.error);
  }

  const admin = getSupabaseAdmin();

  // Fetch every host row
  const { data: hosts, error: hostsErr } = await admin
    .from("hosts")
    .select("*")
    .order("created_at", { ascending: false });
  if (hostsErr || !hosts) return serverError(hostsErr?.message ?? "hosts query failed");

  // Pull the matching auth.users emails in one call
  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailByUserId = new Map<string, string>();
  for (const u of usersList?.users ?? []) {
    if (u.email) emailByUserId.set(u.id, u.email);
  }

  // Pull founder display names for the comped_by foreign key
  const compedByIds = Array.from(new Set(hosts.map((h) => h.comped_by).filter((v): v is string => !!v)));
  const compedByName = new Map<string, string>();
  if (compedByIds.length > 0) {
    const { data: compers } = await admin.from("hosts").select("id, display_name").in("id", compedByIds);
    for (const c of compers ?? []) compedByName.set(c.id, c.display_name);
  }

  const rows: AdminHostRow[] = hosts.map((h) => ({
    id: h.id,
    user_id: h.user_id,
    email: emailByUserId.get(h.user_id) ?? "(unknown)",
    display_name: h.display_name,
    default_venue: h.default_venue,
    role: (h.role === "founder" ? "founder" : "host") as "host" | "founder",
    is_paywall_bypassed: h.is_paywall_bypassed,
    comped_at: h.comped_at,
    comped_by: h.comped_by,
    comped_by_name: h.comped_by ? compedByName.get(h.comped_by) ?? null : null,
    created_at: h.created_at,
  }));

  return ok({ hosts: rows });
}

const CompSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(80),
  defaultVenue: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireFounder();
  if (!auth.ok) {
    if (auth.status === 401) return unauthorized(auth.error);
    return forbidden(auth.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = CompSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  // 1. Find or create the auth user. email_confirm so the magic-link
  //    flow works on first sign-in without a separate confirmation step.
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existingUser = existing?.users.find((u) => u.email === parsed.data.email);
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      email_confirm: true,
      user_metadata: { display_name: parsed.data.displayName },
    });
    if (error || !data.user) {
      return serverError(error?.message ?? "createUser failed");
    }
    userId = data.user.id;
  }

  // 2. Upsert the hosts row. is_paywall_bypassed=true (this whole route's
  //    purpose is to comp them past the paywall). Capture audit fields.
  const { data: hostRow, error: hostErr } = await admin
    .from("hosts")
    .upsert(
      {
        user_id: userId,
        display_name: parsed.data.displayName,
        default_venue: parsed.data.defaultVenue ?? null,
        role: "host",
        is_paywall_bypassed: true,
        comped_at: new Date().toISOString(),
        comped_by: auth.host.id,
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();
  if (hostErr || !hostRow) return serverError(hostErr?.message ?? "hosts upsert failed");

  return ok(
    {
      host: {
        id: hostRow.id,
        user_id: hostRow.user_id,
        email: parsed.data.email,
        display_name: hostRow.display_name,
        default_venue: hostRow.default_venue,
        role: (hostRow.role === "founder" ? "founder" : "host") as "host" | "founder",
        is_paywall_bypassed: hostRow.is_paywall_bypassed,
        comped_at: hostRow.comped_at,
        comped_by: hostRow.comped_by,
        comped_by_name: auth.host.display_name,
        created_at: hostRow.created_at,
      } satisfies AdminHostRow,
    },
    201,
  );
}

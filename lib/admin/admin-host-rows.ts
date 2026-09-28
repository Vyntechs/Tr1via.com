// Founder dashboard rows: every hosts row joined with its auth user's email
// and password state. Shared by GET /api/admin/hosts and the /host/admin
// server page so both read users the same, uncapped way.

import "server-only";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import { listAllAuthUsers } from "@/lib/auth/admin-users";
import {
  PASSWORD_SET_AT_KEY,
  passwordPromptSetting,
  type PasswordPrompt,
} from "@/lib/auth/password-gate";

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
  /** When the host chose a password (app_metadata marker), or null. */
  password_set_at: string | null;
  /** Founder's per-host "Ask to create password" switch; null = never set (off). */
  password_prompt: PasswordPrompt | null;
}

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export type AdminHostRowsResult =
  | { ok: true; rows: AdminHostRow[] }
  | { ok: false; error: string };

export async function loadAdminHostRows(admin: AdminClient): Promise<AdminHostRowsResult> {
  const { data: hosts, error: hostsErr } = await admin
    .from("hosts")
    .select("*")
    .order("created_at", { ascending: false });
  if (hostsErr || !hosts) return { ok: false, error: hostsErr?.message ?? "hosts query failed" };

  // If the auth-user read fails, still return the hosts (email shows as
  // "(unknown)") so the founder's tools on /host/admin keep working.
  const users = await listAllAuthUsers(admin);
  const userById = new Map(users.ok ? users.users.map((u) => [u.id, u]) : []);

  const compedByIds = Array.from(
    new Set(hosts.map((h) => h.comped_by).filter((v): v is string => !!v)),
  );
  const compedByName = new Map<string, string>();
  if (compedByIds.length > 0) {
    const { data: compers } = await admin
      .from("hosts")
      .select("id, display_name")
      .in("id", compedByIds);
    for (const c of compers ?? []) compedByName.set(c.id, c.display_name);
  }

  const rows: AdminHostRow[] = hosts.map((h) => {
    const user = userById.get(h.user_id);
    const setAt = user?.app_metadata?.[PASSWORD_SET_AT_KEY];
    return {
      id: h.id,
      user_id: h.user_id,
      email: user?.email ?? "(unknown)",
      display_name: h.display_name,
      default_venue: h.default_venue,
      role: (h.role === "founder" ? "founder" : "host") as "host" | "founder",
      is_paywall_bypassed: h.is_paywall_bypassed,
      comped_at: h.comped_at,
      comped_by: h.comped_by,
      comped_by_name: h.comped_by ? compedByName.get(h.comped_by) ?? null : null,
      created_at: h.created_at,
      password_set_at: typeof setAt === "string" && setAt ? setAt : null,
      password_prompt: passwordPromptSetting(user?.app_metadata),
    };
  });

  return { ok: true, rows };
}

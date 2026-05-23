// /host/admin — founder-only dashboard. Hidden from non-founders entirely:
//
//   - If not signed in → middleware bounced them to /login already.
//   - If signed in but not a founder → 404 (deny existence).
//   - If signed in and a founder → render the dashboard with pre-fetched hosts.
//
// Server Component does the founder check + initial data fetch; the
// HostAdminClient handles the form + toggles. The page is intentionally
// not linked from anywhere public — only the founder sees the link in
// their HostDashboard (added in a separate commit).

import { notFound, redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { HostAdminClient, type AdminHostRow } from "./HostAdminClient";

export const dynamic = "force-dynamic";

export default async function HostAdminPage() {
  const supa = await getSupabaseServer();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) redirect("/login");

  const admin = getSupabaseAdmin();

  const { data: meHost } = await admin
    .from("hosts")
    .select("id, role, display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!meHost || meHost.role !== "founder") {
    // 404 not 403 — deny the existence of this page to non-founders.
    notFound();
  }

  // Fetch every host row, sorted newest-first
  const { data: hosts } = await admin
    .from("hosts")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const emailByUserId = new Map<string, string>();
  for (const u of usersList?.users ?? []) {
    if (u.email) emailByUserId.set(u.id, u.email);
  }

  const compedByIds = Array.from(new Set((hosts ?? []).map((h) => h.comped_by).filter((v): v is string => !!v)));
  const compedByName = new Map<string, string>();
  if (compedByIds.length > 0) {
    const { data: compers } = await admin.from("hosts").select("id, display_name").in("id", compedByIds);
    for (const c of compers ?? []) compedByName.set(c.id, c.display_name);
  }

  const rows: AdminHostRow[] = (hosts ?? []).map((h) => ({
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

  return <HostAdminClient meDisplayName={meHost.display_name} initialHosts={rows} />;
}

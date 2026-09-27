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
import { loadAdminHostRows, type AdminHostRow } from "@/lib/admin/admin-host-rows";
import { HostAdminClient } from "./HostAdminClient";

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

  // Every host row + its account's email and password state (all pages of
  // auth users, no 200 cap).
  const result = await loadAdminHostRows(admin);
  const rows: AdminHostRow[] = result.ok ? result.rows : [];

  return <HostAdminClient meDisplayName={meHost.display_name} initialHosts={rows} />;
}

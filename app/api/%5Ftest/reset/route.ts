// Wipes test data ONLY. Strict allowlist: emails ending in @tr1via.test.
// Cascade deletes flow through to hosts → nights → games → questions →
// players → answers → reveals.
//
// Brandon's brandon.james.nichols@gmail.com is structurally incapable of
// being touched by this route — the isTestEmail filter excludes any address
// not ending in @tr1via.test.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTestModeEnabled, isTestEmail } from "@/lib/api/require-test-mode";

export async function POST(req: NextRequest) {
  if (!isTestModeEnabled(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const testUsers = (usersList?.users ?? []).filter((u) => isTestEmail(u.email));

  const deleted: string[] = [];
  for (const u of testUsers) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (!error) deleted.push(u.id);
  }

  return NextResponse.json({ deleted: deleted.length });
}

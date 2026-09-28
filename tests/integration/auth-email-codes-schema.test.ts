// @vitest-environment node

// Migration 20260927194103_auth_email_codes.sql on real Postgres (pglite).
// Proves: RLS is on with zero policies; the browser roles (anon,
// authenticated) can't read or write the table; the service role can; and
// the checks reject bad purposes and mixed-case emails.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260927194103_auth_email_codes.sql",
);

describe("auth_email_codes schema", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      -- Supabase's default privileges hand new public tables to the browser
      -- roles; the migration must take them back.
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `);
    await db.exec(readFileSync(MIGRATION, "utf8"));
  });

  afterAll(async () => {
    await db.close();
  });

  test("RLS is on and there are no policies", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.auth_email_codes'::regclass",
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const policies = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_policies where tablename = 'auth_email_codes'",
    );
    expect(policies.rows[0].n).toBe(0);
  });

  test("browser roles have no access; the service role does", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ s: boolean; i: boolean }>(
        `select has_table_privilege('${role}', 'public.auth_email_codes', 'select') as s,
                has_table_privilege('${role}', 'public.auth_email_codes', 'insert') as i`,
      );
      expect(r.rows[0]).toEqual({ s: false, i: false });
    }
    await db.exec("set role service_role");
    await db.exec(`
      insert into public.auth_email_codes (email, code_hash, purpose, expires_at)
      values ('heather@example.com', 'abc', 'login', now() + interval '10 minutes');
    `);
    const rows = await db.query<{ attempts: number; consumed_at: string | null }>(
      "select attempts, consumed_at from public.auth_email_codes",
    );
    expect(rows.rows).toEqual([{ attempts: 0, consumed_at: null }]);
    await db.exec("reset role");
  });

  test("rejects an unknown purpose and a mixed-case email", async () => {
    await expect(
      db.exec(`insert into public.auth_email_codes (email, code_hash, purpose, expires_at)
               values ('a@example.com', 'x', 'admin', now())`),
    ).rejects.toThrow();
    await expect(
      db.exec(`insert into public.auth_email_codes (email, code_hash, purpose, expires_at)
               values ('A@Example.com', 'x', 'login', now())`),
    ).rejects.toThrow();
  });
});

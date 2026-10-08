// The column names of the diagnostic tables, read from the migration itself.
// Used to prove that the rows the app builds only name real columns: the
// database function diag_insert_rows ignores a key that is not a column, so a
// misspelt or renamed key would otherwise be dropped without a sound.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = path.join(ROOT, "supabase/migrations/20261007180000_diagnostic_logs.sql");

export type DiagTableName = "diag_answer_events" | "diag_server_actions" | "diag_device_events";

export function diagTableColumns(table: DiagTableName): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  if (start < 0) throw new Error(`table ${table} not found in the migration`);
  const body = sql.slice(start, sql.indexOf("\n);", start));
  const columns: string[] = [];
  for (const line of body.split("\n").slice(1)) {
    // a column starts exactly two spaces in; continuation lines and comments do not
    const match = /^ {2}([a-z_][a-z0-9_]*)\s/.exec(line);
    if (match) columns.push(match[1]!);
  }
  return columns;
}

/** Every key of every row must be a column of the table. Returns the keys that are not. */
export function unknownKeys(table: DiagTableName, rows: Record<string, unknown>[]): string[] {
  const known = new Set(diagTableColumns(table));
  const unknown = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!known.has(key)) unknown.add(key);
  return [...unknown];
}

// In-memory CodeStore for tests — same contract as the Supabase store
// (compare-and-set tries, single-use consume, newest-unconsumed lookup).

import type { CodePurpose, CodeRow, CodeStore, NewCodeRow } from "@/lib/auth/email-codes";

export function memoryCodeStore(): CodeStore & { rows: CodeRow[] } {
  const rows: CodeRow[] = [];
  let n = 0;
  return {
    rows,
    async countSince(email, sinceIso) {
      return rows.filter((r) => r.created_at >= sinceIso && (email === null || r.email === email)).length;
    },
    async retireActive(email: string, purpose: CodePurpose, nowIso: string) {
      for (const r of rows) {
        if (r.email === email && r.purpose === purpose && r.consumed_at === null) r.consumed_at = nowIso;
      }
    },
    async insert(row: NewCodeRow) {
      rows.push({ ...row, id: `code-${++n}`, attempts: 0, consumed_at: null });
    },
    async findNewestActive(email: string, purpose: CodePurpose) {
      const hits = rows
        .filter((r) => r.email === email && r.purpose === purpose && r.consumed_at === null)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      return hits[0] ? { ...hits[0] } : null;
    },
    async bumpAttempts(id: string, expected: number) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.consumed_at !== null || r.attempts !== expected) return false;
      r.attempts = expected + 1;
      return true;
    },
    async consume(id: string, nowIso: string) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.consumed_at !== null) return false;
      r.consumed_at = nowIso;
      return true;
    },
    async deleteOlderThan(beforeIso: string) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].created_at < beforeIso) rows.splice(i, 1);
    },
  };
}

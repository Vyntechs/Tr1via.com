// Tiny stand-in for the admin client's query builder, enough for
// lib/auth/live-show.ts (hosts → nights → games) and the founder-flag
// hosts lookup: select / eq / is / not(col, "is", null) / in / gte / limit,
// awaited directly or via maybeSingle(). Rows are read at query time, so a
// test can change them between requests. `fail` makes every query error.

type Row = Record<string, unknown>;

export interface FakeShowDb {
  tables: Record<string, () => Row[]>;
  fail: boolean;
  from: (table: string) => unknown;
}

export function fakeShowDb(tables: Record<string, () => Row[]> = {}): FakeShowDb {
  const self: FakeShowDb = {
    tables,
    fail: false,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const run = () => (self.tables[table]?.() ?? []).filter((r) => filters.every((f) => f(r)));
      const answer = () =>
        self.fail ? { data: null, error: { message: "database down" } } : { data: run(), error: null };
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
        is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
        not: (col: string, _op: "is", v: unknown) => (filters.push((r) => (r[col] ?? null) !== v), q),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
        gte: (col: string, v: string) =>
          (filters.push((r) => typeof r[col] === "string" && (r[col] as string) >= v), q),
        limit: () => q,
        maybeSingle: async () => {
          const a = answer();
          return a.error ? a : { data: (a.data as Row[])[0] ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(answer()).then(res, rej),
      };
      return q;
    },
  };
  return self;
}

/**
 * A night created and opened `hoursAgo` hours before now (closed_at empty
 * unless given; `extra` can override created_at / opened_at).
 */
export function openedNight(hostId: string, hoursAgo: number, extra: Row = {}): Row {
  const at = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return {
    id: `night-${hostId}-${hoursAgo}`,
    host_id: hostId,
    created_at: at,
    opened_at: at,
    closed_at: null,
    ...extra,
  };
}

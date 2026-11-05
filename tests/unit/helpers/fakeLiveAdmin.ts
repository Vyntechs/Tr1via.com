// A small in-memory stand-in for the Supabase admin client, for the closer and
// scoring tests. Filters really narrow the seeded rows and updates really change
// them, so a test can read the end state. `before` runs ahead of each query, so
// a test can hang one or note the order things happened in.

import { vi } from "vitest";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

export interface FakeWrite {
  table: string;
  op: "update" | "insert";
  values: Row;
  filters: unknown[][];
}

export function fakeLiveAdmin(
  seed: Record<string, Row[]>,
  options: {
    rpc?: (name: string, args: unknown) => Promise<Result>;
    before?: (table: string, op: "read" | "update" | "insert") => Promise<void> | void;
    updateError?: Record<string, Result["error"]>;
    insertResult?: Record<string, Result>;
  } = {},
) {
  const writes: FakeWrite[] = [];
  const reads: string[] = [];

  const from = vi.fn((table: string) => {
    let rows = [...(seed[table] ?? [])];
    const filters: unknown[][] = [];
    let update: Row | null = null;
    let insert: Row | null = null;

    const run = async (single: boolean): Promise<Result> => {
      const op = update ? "update" : insert ? "insert" : "read";
      await options.before?.(table, op);
      if (insert) {
        writes.push({ table, op: "insert", values: insert, filters });
        return options.insertResult?.[table] ?? { data: null, error: null };
      }
      if (update) {
        const error = options.updateError?.[table] ?? null;
        writes.push({ table, op: "update", values: update, filters });
        if (error) return { data: null, error };
        for (const row of rows) Object.assign(row, update);
      } else {
        reads.push(table);
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push(["eq", column, value]);
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] !== value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push(["is", column, value]);
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      not: (column: string, _op: string, value: unknown) => {
        rows = rows.filter((row) => (row[column] ?? null) !== value);
        return builder;
      },
      order: (column: string, sort?: { ascending?: boolean }) => {
        const direction = sort?.ascending === false ? -1 : 1;
        rows.sort(
          (a, b) => String(a[column]).localeCompare(String(b[column])) * direction,
        );
        return builder;
      },
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return builder;
      },
      update: (values: Row) => {
        update = values;
        return builder;
      },
      insert: (values: Row) => {
        insert = values;
        return builder;
      },
      maybeSingle: () => run(true),
      single: () => run(true),
      then: (
        onDone: (value: Result) => unknown,
        onFail?: (reason: unknown) => unknown,
      ) => run(false).then(onDone, onFail),
    };
    return builder;
  });

  const rpc = vi.fn(
    options.rpc ?? (async (): Promise<Result> => ({ data: true, error: null })),
  );
  return { from, rpc, writes, reads };
}

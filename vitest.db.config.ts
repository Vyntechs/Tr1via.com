import { defineConfig } from "vitest/config";

/**
 * These tests deliberately connect to the local Supabase PostgreSQL server.
 * PGlite shares one process and therefore cannot exercise PostgreSQL locks.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/concurrency/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

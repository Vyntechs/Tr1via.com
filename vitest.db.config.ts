import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * These tests deliberately connect to the local Supabase PostgreSQL server.
 * PGlite shares one process and therefore cannot exercise PostgreSQL locks.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/concurrency/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

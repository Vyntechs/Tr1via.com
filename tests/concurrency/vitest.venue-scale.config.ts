import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": repoRoot,
      "server-only": path.join(repoRoot, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
    setupFiles: [path.join(repoRoot, "tests/setup.ts")],
    include: [
      "tests/concurrency/legacy-venue-load-contract.test.ts",
      "tests/unit/api-room-snapshot-route.test.ts",
      "tests/unit/poll-stampede.test.ts",
      "tests/unit/useRoom-player-signed-snapshot.test.tsx",
    ],
    fileParallelism: false,
    testTimeout: 10_000,
  },
});

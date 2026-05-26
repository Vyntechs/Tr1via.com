import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      // Next.js ships `server-only` as a virtual module; under Vitest we
      // stub it with an empty file so tests can import server-tagged modules
      // without exploding. (Production behaviour is unchanged.)
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      // Give jsdom a real-looking origin so window.localStorage works.
      // (Without this, jsdom uses about:blank → opaque origin → SecurityError.)
      jsdom: { url: "http://localhost/" },
    },
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/component/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules", ".next"],
  },
});

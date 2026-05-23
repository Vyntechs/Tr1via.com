// Test-only stub for Next.js's `server-only` marker module.
//
// In production, `import "server-only";` is a build-time guard from Next.js
// that fails compilation if a Client Component imports it. Vitest doesn't
// know about that guard, so it tries to resolve the literal package and
// errors. We alias `server-only` to this empty file in vitest.config.ts
// so server-tagged modules can be imported under Vitest.
export {};

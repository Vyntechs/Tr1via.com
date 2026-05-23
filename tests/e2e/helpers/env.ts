// Test runner constants. Match playwright.config.ts's webServer env block
// so helpers can construct the right x-test-secret header.
export const TEST_SECRET = process.env.TEST_SECRET ?? "local-test-secret";

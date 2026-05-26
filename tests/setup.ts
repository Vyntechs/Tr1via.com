import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Ensure DOM is cleaned between tests even when globals:false (the
// @testing-library/react auto-cleanup hook requires Vitest globals).
afterEach(cleanup);

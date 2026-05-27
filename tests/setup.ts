import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Ensure DOM is cleaned between tests even when globals:false (the
// @testing-library/react auto-cleanup hook requires Vitest globals).
afterEach(cleanup);

// Node 26 ships an experimental built-in localStorage that shadows jsdom's
// (and is gated on a --localstorage-file flag we don't pass), so window.localStorage
// reads as undefined. Install a minimal in-memory Storage so jsdom-style tests
// can read/write. Cleared between tests via the afterEach below.
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const makeStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
    };
  };
  Object.defineProperty(window, "localStorage", { value: makeStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: makeStorage(), configurable: true });
}

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

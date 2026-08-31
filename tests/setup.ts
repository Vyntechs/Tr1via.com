import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

declare global {
  // Enabled only by a spec that owns a strict MSW provider fixture lifecycle.
  // Missed handlers still fail because those specs use onUnhandledRequest:error.
  var __TR1VIA_PROVIDER_MSW_ACTIVE__: boolean | undefined;
}

const providerHosts = new Set(["api.anthropic.com", "api.pexels.com"]);
const directFetch = globalThis.fetch.bind(globalThis);

function fetchUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new URL(raw);
  } catch {
    return null;
  }
}

delete process.env.ANTHROPIC_API_KEY;
delete process.env.PEXELS_API_KEY;
globalThis.__TR1VIA_PROVIDER_MSW_ACTIVE__ = false;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = fetchUrl(input);
  if (
    url &&
    providerHosts.has(url.hostname) &&
    !globalThis.__TR1VIA_PROVIDER_MSW_ACTIVE__
  ) {
    return Promise.reject(
      new Error(
        `Provider-cost guard blocked direct request to ${url.hostname}; use an injected fake or strict MSW fixture.`,
      ),
    );
  }
  return directFetch(input, init);
};

// Ensure DOM is cleaned between tests even when globals:false (the
// @testing-library/react auto-cleanup hook requires Vitest globals).
afterEach(() => {
  cleanup();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.PEXELS_API_KEY;
  globalThis.__TR1VIA_PROVIDER_MSW_ACTIVE__ = false;
});

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

// jsdom doesn't ship ResizeObserver. useAutoFitText (player question
// auto-fit) uses it to re-measure on orientation change; tests just need
// the constructor + observe/disconnect surface to exist so the hook can
// install/cleanup its observer without throwing.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

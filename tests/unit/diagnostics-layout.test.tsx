// @vitest-environment jsdom
// The root layout only includes the diagnostic mount when the switch is on.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
  Bricolage_Grotesque: () => ({ variable: "--font-bricolage" }),
}));
vi.mock("@/components/diagnostics/DiagnosticsMount", () => ({
  DiagnosticsMount: () => <span data-testid="diag-mount" />,
}));

import RootLayout from "@/app/layout";

afterEach(() => vi.unstubAllEnvs());

function page() {
  return renderToStaticMarkup(
    <RootLayout>
      <div id="kid" />
    </RootLayout>,
  );
}

describe("RootLayout diagnostic mount", () => {
  it("is not in the page by default", () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "");
    expect(page()).not.toContain("diag-mount");
  });

  it("is not in the page when the switch says off", () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "off");
    const html = page();
    expect(html).not.toContain("diag-mount");
    expect(html).toContain('id="kid"');
  });

  it("is in the page, after the content, when the switch is on", () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    const html = page();
    expect(html).toContain("diag-mount");
    expect(html.indexOf('id="kid"')).toBeLessThan(html.indexOf("diag-mount"));
  });
});

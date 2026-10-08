import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPolicyPage from "@/app/privacy/page";

describe("privacy device disclosure", () => {
  it("describes signed HTTP-only identity without claiming a browser-readable copy", () => {
    const { container } = render(<PrivacyPolicyPage />);
    const copy = container.textContent ?? "";

    expect(copy).toContain("signed HTTP-only cookie");
    expect(copy).toContain("browser JavaScript cannot read");
    expect(copy).not.toContain("tr1via_device_id");
    expect(copy).not.toContain("one browser storage value");
  });

  it("keeps the canonical markdown mirror on the same signed-cookie disclosure", () => {
    const copy = readFileSync(
      resolve(process.cwd(), "docs/legal/privacy-policy.md"),
      "utf8",
    );

    expect(copy).toContain("signed HTTP-only cookie");
    expect(copy).toContain("browser JavaScript cannot read");
    expect(copy).not.toContain("tr1via_device_id");
    expect(copy).not.toContain("one browser storage value");
    expect(copy).not.toContain("browser's local storage");
  });

  it("says timing logs may be switched on for live games, on the page and in the mirror", () => {
    const sentence =
      "When we are investigating lag, we may switch on timing logs for live games. They record when each tap, button press and screen update happened, which answer was tapped, and how long each step took, with the device identifier and a short device summary (browser, operating system, device type, connection type and speed, rough screen size, a few display settings and the app version, but no IP address or name), and are deleted after 45 days.";
    const { container } = render(<PrivacyPolicyPage />);
    const page = (container.textContent ?? "").replace(/\s+/g, " ");
    const mirror = readFileSync(
      resolve(process.cwd(), "docs/legal/privacy-policy.md"),
      "utf8",
    );

    expect(page).toContain(sentence);
    expect(mirror).toContain(sentence);
    expect(page).toContain("Last updated October 8, 2026");
    expect(mirror).toContain("Last updated October 8, 2026");
  });
});

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
});

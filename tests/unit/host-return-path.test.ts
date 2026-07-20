import { describe, expect, it } from "vitest";

import { hostReturnPath } from "@/lib/host/hostReturnPath";

describe("hostReturnPath", () => {
  it.each([
    [null, "/host"],
    ["", "/host"],
    ["/host", "/host"],
    ["/host/live/night-1", "/host/live/night-1"],
    ["/host/setup/night-1", "/host/setup/night-1"],
    ["//evil.test/host", "/host"],
    ["https://evil.test/host", "/host"],
    ["/pricing", "/host"],
    ["/hostile", "/host"],
  ])("normalizes %s to %s", (value, expected) => {
    expect(hostReturnPath(value)).toBe(expected);
  });
});

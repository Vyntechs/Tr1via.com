import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("unified live host route", () => {
  it("switches the canonical /host/live route to the private phone controller on compact screens", () => {
    const client = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/HostLiveConsoleClient.tsx"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/page.tsx"),
      "utf8",
    );

    expect(client).toContain('useMediaQuery("(max-width: 860px)")');
    expect(client).toContain("<HostPhoneClient");
    expect(page).toContain("hostName={owned.host.display_name}");
  });
});

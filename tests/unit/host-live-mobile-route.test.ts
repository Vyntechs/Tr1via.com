import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("host live privacy boundary", () => {
  it.each([320, 844])(
    "keeps /host/live venue-safe at %ipx instead of selecting private UI by viewport",
    () => {
    const client = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/HostLiveConsoleClient.tsx"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/page.tsx"),
      "utf8",
    );

      expect(client).not.toContain("HostPhoneClient");
      expect(client).not.toContain('useMediaQuery("(max-width: 860px)")');
      expect(page).not.toContain("hostName={owned.host.display_name}");
    },
  );

  it("keeps the correct-answer preview behind the explicit private phone route", () => {
    const phonePage = readFileSync(
      join(process.cwd(), "app/host/phone/[nightId]/page.tsx"),
      "utf8",
    );
    const privatePreview = readFileSync(
      join(process.cwd(), "components/host/HostPhoneUpcoming.tsx"),
      "utf8",
    );

    expect(phonePage).toContain("<HostPhoneClient");
    expect(privatePreview).toContain("CORRECT");
  });

  it("removes the chip reserve at the layout boundary without negative-margin cancellation", () => {
    const livePage = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/page.tsx"),
      "utf8",
    );
    const phoneClient = readFileSync(
      join(process.cwd(), "app/host/phone/[nightId]/HostPhoneClient.tsx"),
      "utf8",
    );
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

    expect(livePage).not.toContain("marginTop: \"calc(-1 * var(--host-chip-reserve");
    expect(phoneClient).not.toContain("marginTop: \"calc(-1 * var(--host-chip-reserve");
    expect(livePage).toContain('data-host-full-bleed="true"');
    expect(phoneClient).toContain('data-host-full-bleed="true"');
    expect(css).toContain(':has([data-host-full-bleed="true"])');
  });
});

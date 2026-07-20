import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("host live device routing", () => {
  it.each([320, 844])(
    "falls back to the private controller when /host/live is opened at %ipx",
    () => {
    const client = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/HostLiveConsoleClient.tsx"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/page.tsx"),
      "utf8",
    );

      expect(client).toContain("HostPhoneClient");
      expect(client).toContain('useMediaQuery("(max-width: 860px)")');
      expect(page).toContain("hostName={owned.host.display_name}");
    },
  );

  it("keeps old phone links safe by redirecting them to the owned canonical game", () => {
    const phonePage = readFileSync(
      join(process.cwd(), "app/host/phone/[nightId]/page.tsx"),
      "utf8",
    );
    expect(phonePage).toContain("requireOwnedNight(nightId)");
    expect(phonePage).toContain("redirect(`/host/live/${owned.night.id}`)");
    expect(phonePage).not.toContain("<HostPhoneClient");
  });

  it("does not pass a host pairing URL into the desktop console", () => {
    const client = readFileSync(
      join(process.cwd(), "app/host/live/[nightId]/HostLiveConsoleClient.tsx"),
      "utf8",
    );

    expect(client).not.toContain("privateControlUrl");
    expect(client).not.toContain("/host/phone/${nightId}");
  });

  it("keeps the public venue route out of the compact host controller", () => {
    const phoneClient = readFileSync(
      join(process.cwd(), "app/host/phone/[nightId]/HostPhoneClient.tsx"),
      "utf8",
    );

    expect(phoneClient).not.toContain('href={`/tv/${roomCode}`}');
    expect(phoneClient).not.toContain("TV view ↗");
    expect(phoneClient).not.toContain("Open venue screen");
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

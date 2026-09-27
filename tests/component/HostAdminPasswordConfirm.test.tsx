// Founder admin — "Ask to create password" switch needs a clear confirm
// before it turns ON (turning it off is immediate).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostAdminClient } from "@/app/host/admin/HostAdminClient";
import { ThemeProvider } from "@/components/system";
import type { AdminHostRow } from "@/lib/admin/admin-host-rows";

const HEATHER: AdminHostRow = {
  id: "host-h",
  user_id: "user-h",
  email: "heather@example.com",
  display_name: "Heather",
  default_venue: null,
  role: "host",
  is_paywall_bypassed: true,
  comped_at: null,
  comped_by: null,
  comped_by_name: null,
  created_at: new Date(Date.UTC(2026, 4, 1)).toISOString(),
  password_set_at: null,
  password_prompt: null,
};

const fetchMock = vi.fn();

function renderAdmin(host: AdminHostRow = HEATHER) {
  render(
    <ThemeProvider themeKey="house">
      <HostAdminClient meDisplayName="Brandon" initialHosts={[host]} />
    </ThemeProvider>,
  );
}

const promptSwitch = () => screen.getByRole("switch", { name: "Ask Heather to create a password" });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Ask to create password — confirm before turning on", () => {
  it("asks first, in plain words, and saves nothing until 'Yes'", async () => {
    renderAdmin();
    fireEvent.click(promptSwitch());
    const confirm = screen.getByTestId("host-password-confirm-host-h");
    expect(confirm).toHaveTextContent(
      "Turn on for Heather? Next time she opens TR1VIA (not during a show) she'll be asked to create a password.",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("host-password-confirm-yes-host-h"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/hosts/host-h");
    expect(JSON.parse(init.body)).toEqual({ passwordPrompt: "on" });
    expect(screen.queryByTestId("host-password-confirm-host-h")).toBeNull();
    expect(promptSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("Cancel leaves it off and saves nothing", () => {
    renderAdmin();
    fireEvent.click(promptSwitch());
    fireEvent.click(screen.getByTestId("host-password-confirm-cancel-host-h"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(promptSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("turning it off needs no confirm", async () => {
    renderAdmin({ ...HEATHER, password_prompt: "on" });
    fireEvent.click(promptSwitch());
    expect(screen.queryByTestId("host-password-confirm-host-h")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ passwordPrompt: "off" });
  });
});

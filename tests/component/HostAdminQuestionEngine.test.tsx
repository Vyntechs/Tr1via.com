// Founder admin — "Question engine: Classic / New" per host, including the
// founder's own card. A failed save puts only this switch back and says why.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostAdminClient } from "@/app/host/admin/HostAdminClient";
import { ThemeProvider } from "@/components/system";
import type { AdminHostRow } from "@/lib/admin/admin-host-rows";

const base: Omit<AdminHostRow, "id" | "user_id" | "email" | "display_name" | "role"> = {
  default_venue: null,
  is_paywall_bypassed: true,
  comped_at: null,
  comped_by: null,
  comped_by_name: null,
  created_at: new Date(Date.UTC(2026, 4, 1)).toISOString(),
  password_set_at: null,
  password_prompt: null,
  question_engine: "classic",
};
const HEATHER: AdminHostRow = {
  ...base, id: "host-h", user_id: "user-h", email: "h@example.com", display_name: "Heather", role: "host",
};
const BRANDON: AdminHostRow = {
  ...base, id: "host-b", user_id: "user-b", email: "b@example.com", display_name: "Brandon", role: "founder",
};

const fetchMock = vi.fn();
const renderAdmin = () =>
  render(
    <ThemeProvider themeKey="house">
      <HostAdminClient meDisplayName="Brandon" initialHosts={[BRANDON, HEATHER]} />
    </ThemeProvider>,
  );

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ updated: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Question engine switch on /host/admin", () => {
  it("shows Classic by default on every card, the founder's included", () => {
    renderAdmin();
    for (const id of ["host-b", "host-h"]) {
      expect(screen.getByTestId(`host-question-engine-classic-${id}`)).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId(`host-question-engine-new-${id}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("flipping the founder to New PATCHes only { questionEngine: 'new' }", async () => {
    renderAdmin();
    fireEvent.click(screen.getByTestId("host-question-engine-new-host-b"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/hosts/host-b");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ questionEngine: "new" });
    await waitFor(() =>
      expect(screen.getByTestId("host-question-engine-new-host-b")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByTestId("host-question-engine-new-host-h")).toHaveAttribute("aria-pressed", "false");
  });

  it("a failed save goes back to Classic and shows the reason", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ updated: true, questionEngineError: "Question engine not saved (the setting table may not be set up yet)." }),
        { status: 200 },
      ),
    );
    renderAdmin();
    fireEvent.click(screen.getByTestId("host-question-engine-new-host-h"));
    await waitFor(() =>
      expect(screen.getByTestId("host-question-engine-error-host-h")).toHaveTextContent(/not saved/i),
    );
    expect(screen.getByTestId("host-question-engine-classic-host-h")).toHaveAttribute("aria-pressed", "true");
    // The paywall switch for Heather is untouched.
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
  });
});

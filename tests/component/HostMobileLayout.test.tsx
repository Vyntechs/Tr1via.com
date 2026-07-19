import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  HostGenEdit,
  HostGenImageSwap,
  HostGenImageUpload,
  HostGenLoading,
  HostGenManualEntry,
  HostGenOverview,
  HostGenPick,
  HostGenTopicEntry,
} from "@/components/host/gen";

function installMobileMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("phone-first host generation layouts", () => {
  beforeEach(() => {
    installMobileMatchMedia();
    window.sessionStorage.clear();
  });

  it.each([
    ["overview", <HostGenOverview key="overview" themeKey="house" />, "host-gen-overview-layout"],
    ["topic entry", <HostGenTopicEntry key="topic" themeKey="house" />, "host-gen-topic-layout"],
    ["loading", <HostGenLoading key="loading" themeKey="house" />, "host-gen-loading-layout"],
    [
      "pick and audit",
      <HostGenPick key="pick" themeKey="house" onTogglePick={() => {}} />,
      "host-gen-pick-layout",
    ],
    ["question edit", <HostGenEdit key="edit" themeKey="house" />, "host-gen-edit-layout"],
    ["image swap", <HostGenImageSwap key="swap" themeKey="house" />, "host-gen-image-swap-layout"],
    ["image upload", <HostGenImageUpload key="upload" themeKey="house" />, "host-gen-image-upload-layout"],
    ["manual entry", <HostGenManualEntry key="manual" themeKey="house" />, "host-gen-manual-layout"],
  ])("marks %s as the compact single-column task flow", async (_name, ui, testId) => {
    render(ui);
    const layout = await screen.findByTestId(testId);
    await waitFor(() => expect(layout).toHaveAttribute("data-layout", "mobile"));
  });

  it("keeps overview slot actions and the primary room action thumb-safe", async () => {
    render(
      <HostGenOverview
        themeKey="house"
        isReadyToOpen
        onAddTopic={() => {}}
        onOpenRoom={() => {}}
      />,
    );

    const [addTopic] = await screen.findAllByRole("button", { name: /add a topic/i });
    const openNight = screen.getByRole("button", { name: /open the night/i });

    await waitFor(() => {
      expect(addTopic).toHaveStyle({ minHeight: "104px" });
      expect(openNight).toHaveStyle({ minHeight: "52px" });
    });
  });

  it("uses a phone-sized topic field and a sticky-safe primary action", async () => {
    render(<HostGenTopicEntry themeKey="house" />);

    const input = screen.getByPlaceholderText("Pixar Movies");
    const submit = screen.getByRole("button", { name: /pull 20 questions/i });
    await waitFor(() => {
      expect(input).toHaveStyle({ fontSize: "42px" });
      expect(submit).toHaveStyle({ minHeight: "52px" });
    });
  });

  it("restores unfinished topic and manual-entry drafts after leaving the route", async () => {
    const topicView = render(<HostGenTopicEntry themeKey="house" draftKey="topic-draft" />);
    fireEvent.change(screen.getByPlaceholderText("Pixar Movies"), {
      target: { value: "Madison supper clubs" },
    });
    topicView.unmount();

    render(<HostGenTopicEntry themeKey="house" draftKey="topic-draft" />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Pixar Movies")).toHaveValue(
        "Madison supper clubs",
      ),
    );

    const manualView = render(<HostGenManualEntry themeKey="house" draftKey="manual-draft" />);
    fireEvent.change(screen.getByLabelText("Question prompt for row 1"), {
      target: { value: "Which lake borders downtown Madison?" },
    });
    manualView.unmount();

    render(<HostGenManualEntry themeKey="house" draftKey="manual-draft" />);
    await waitFor(() =>
      expect(screen.getByLabelText("Question prompt for row 1")).toHaveValue(
        "Which lake borders downtown Madison?",
      ),
    );
  });

  it("discards malformed manual draft fields instead of rendering stale shapes", async () => {
    window.sessionStorage.setItem(
      "malformed-manual",
      JSON.stringify([
        {
          prompt: 42,
          options: [false, null, { stale: true }, ["nested"]],
          correctIndex: 99,
          imageUrl: { unsafe: true },
        },
      ]),
    );

    render(
      <HostGenManualEntry themeKey="house" draftKey="malformed-manual" />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Question prompt for row 1")).toHaveValue(""),
    );
    expect(screen.getByLabelText("Row 1 option 1")).toHaveValue("");
    expect(screen.getByLabelText("Row 1 option 4")).toHaveValue("");
    expect(screen.getByLabelText("Row 1 optional image URL")).toHaveValue("");
  });

  it("scopes complete touch sizing to host mobile surfaces", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const pick = readFileSync(
      join(process.cwd(), "components/host/gen/HostGenPick.tsx"),
      "utf8",
    );

    expect(css).toContain('[data-host-mobile-surface="true"] :is(');
    expect(css).toContain("button,");
    expect(css).toContain("a[href],");
    expect(css).toContain('input:not([type="hidden"]),');
    expect(css).toContain('[role="button"]');
    expect(pick).toContain('gridColumn: mobile ? "2 / -1"');
  });
});

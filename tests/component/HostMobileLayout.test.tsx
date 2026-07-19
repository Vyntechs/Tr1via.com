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
    ["overview", <HostGenOverview themeKey="house" />, "host-gen-overview-layout"],
    ["topic entry", <HostGenTopicEntry themeKey="house" />, "host-gen-topic-layout"],
    ["loading", <HostGenLoading themeKey="house" />, "host-gen-loading-layout"],
    [
      "pick and audit",
      <HostGenPick themeKey="house" onTogglePick={() => {}} />,
      "host-gen-pick-layout",
    ],
    ["question edit", <HostGenEdit themeKey="house" />, "host-gen-edit-layout"],
    ["image swap", <HostGenImageSwap themeKey="house" />, "host-gen-image-swap-layout"],
    ["image upload", <HostGenImageUpload themeKey="house" />, "host-gen-image-upload-layout"],
    ["manual entry", <HostGenManualEntry themeKey="house" />, "host-gen-manual-layout"],
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
});

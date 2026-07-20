// Component tests for ResetGameConfirmModal.
//
// Pure-props modal. We verify: render with counts; Cancel calls onCancel
// and not onConfirm; Confirm calls onConfirm; isSubmitting disables
// both buttons.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetGameConfirmModal } from "@/components/host/ResetGameConfirmModal";

const PREVIEW = {
  revealsToWipe: 18,
  adjustmentsToWipe: 0,
  answersToWipe: 25,
  finishedQuestionsToWipe: 9,
  categoriesKept: 6,
  pickedQuestionsKept: 21,
  playersInRoom: 4,
  categoryNamesSample: ["Karate", "Skirts"],
};

function renderModal(overrides: Partial<React.ComponentProps<typeof ResetGameConfirmModal>> = {}) {
  const props = {
    open: true,
    venueName: "Soul Fire Pizza",
    preview: PREVIEW,
    isSubmitting: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ResetGameConfirmModal {...props} />);
  return props;
}

describe("ResetGameConfirmModal", () => {
  it("does not render when closed", () => {
    render(
      <ResetGameConfirmModal
        open={false}
        venueName="Soul Fire Pizza"
        preview={PREVIEW}
        isSubmitting={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });

  it("shows the venue name in the header", () => {
    renderModal();
    expect(screen.getByText(/Soul Fire Pizza/)).toBeInTheDocument();
  });

  it("shows the wipe counts plainly", () => {
    renderModal();
    expect(screen.getByText(/25 answers/i)).toBeInTheDocument();
    expect(screen.getByText(/18 reveal events/i)).toBeInTheDocument();
    expect(screen.getByText(/9 played-question markers/i)).toBeInTheDocument();
    expect(screen.getByText(/from 4 players/i)).toBeInTheDocument();
  });

  it("shows the adjustments bullet when > 0", () => {
    renderModal({
      preview: { ...PREVIEW, adjustmentsToWipe: 3 },
    });
    expect(screen.getByText(/3 point adjustments/i)).toBeInTheDocument();
  });

  it("shows the keep counts plainly", () => {
    renderModal();
    expect(screen.getByText(/6 categories/i)).toBeInTheDocument();
    expect(screen.getByText(/21 picked questions/i)).toBeInTheDocument();
    expect(screen.getByText(/Karate/)).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when the red 'Yes, reset this game' is clicked", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /yes, reset this game/i }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("disables both buttons while isSubmitting", () => {
    renderModal({ isSubmitting: true });
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resetting|yes, reset this game/i })).toBeDisabled();
  });
});

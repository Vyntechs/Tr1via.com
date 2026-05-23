// HostGenManualEntry — the manual fallback form. 7 rows, position-driven
// point assignment (100..700). Validates each row inline and only fires
// onSubmit when every row passes.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { HostGenManualEntry } from "@/components/host/gen/HostGenManualEntry";

afterEach(() => cleanup());

function fillRow(
  rowIdx: number,
  data: {
    prompt: string;
    options: [string, string, string, string];
    correctIndex?: 0 | 1 | 2 | 3;
  },
) {
  const prompt = screen.getByLabelText(
    new RegExp(`^question prompt for row ${rowIdx + 1}$`, "i"),
  ) as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: data.prompt } });
  data.options.forEach((opt, optIdx) => {
    const input = screen.getByLabelText(
      new RegExp(`^row ${rowIdx + 1} option ${optIdx + 1}$`, "i"),
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: opt } });
  });
  if (data.correctIndex !== undefined && data.correctIndex !== 0) {
    const markBtn = screen.getByRole("button", {
      name: new RegExp(
        `^mark row ${rowIdx + 1} option ${data.correctIndex + 1} as correct$`,
        "i",
      ),
    });
    fireEvent.click(markBtn);
  }
}

describe("HostGenManualEntry", () => {
  it("renders all 7 rows with their point tags 100..700", () => {
    render(<HostGenManualEntry themeKey="house" topic="Test" />);
    for (const pts of [100, 200, 300, 400, 500, 600, 700]) {
      expect(screen.getByText(String(pts))).toBeInTheDocument();
    }
    expect(screen.getAllByText(/ROW \d/)).toHaveLength(7);
    expect(screen.getByText(/EASIEST/)).toBeInTheDocument();
    expect(screen.getByText(/HARDEST/)).toBeInTheDocument();
  });

  it("calls onSubmit with cleaned values in row order when all 7 are valid", () => {
    const onSubmit = vi.fn();
    render(
      <HostGenManualEntry themeKey="house" topic="Test" onSubmit={onSubmit} />,
    );
    for (let i = 0; i < 7; i++) {
      fillRow(i, {
        prompt: `Question prompt number ${i + 1}?`,
        options: [
          `Row ${i + 1} option A`,
          `Row ${i + 1} option B`,
          `Row ${i + 1} option C`,
          `Row ${i + 1} option D`,
        ],
        correctIndex: i === 3 ? 2 : 0,
      });
    }
    fireEvent.click(
      screen.getByRole("button", { name: /lock the category/i }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0] as Array<{
      prompt: string;
      options: string[];
      correctIndex: number;
      imageUrl: string | null;
    }>;
    expect(submitted).toHaveLength(7);
    expect(submitted[0]!.prompt).toBe("Question prompt number 1?");
    expect(submitted[3]!.correctIndex).toBe(2);
    expect(submitted[6]!.options).toEqual([
      "Row 7 option A",
      "Row 7 option B",
      "Row 7 option C",
      "Row 7 option D",
    ]);
  });

  it("blocks submit and surfaces field errors when a row is incomplete", () => {
    const onSubmit = vi.fn();
    render(
      <HostGenManualEntry themeKey="house" topic="Test" onSubmit={onSubmit} />,
    );
    // Only fill 6 rows, leave row 6 empty.
    for (let i = 0; i < 6; i++) {
      fillRow(i, {
        prompt: `Question prompt number ${i + 1}?`,
        options: [
          `Row ${i + 1} option A`,
          `Row ${i + 1} option B`,
          `Row ${i + 1} option C`,
          `Row ${i + 1} option D`,
        ],
      });
    }
    fireEvent.click(
      screen.getByRole("button", { name: /lock the category/i }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    // The empty row 7 surfaces an error.
    expect(
      screen.getAllByText(/fill in all four answer options/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/fix the highlighted rows/i),
    ).toBeInTheDocument();
  });

  it("rejects duplicate option text within a row", () => {
    const onSubmit = vi.fn();
    render(
      <HostGenManualEntry themeKey="house" topic="Test" onSubmit={onSubmit} />,
    );
    for (let i = 0; i < 7; i++) {
      const dup = i === 2;
      fillRow(i, {
        prompt: `Question prompt number ${i + 1}?`,
        options: dup
          ? ["Same", "Same", "Other", "Different"]
          : [
              `Row ${i + 1} A`,
              `Row ${i + 1} B`,
              `Row ${i + 1} C`,
              `Row ${i + 1} D`,
            ],
      });
    }
    fireEvent.click(
      screen.getByRole("button", { name: /lock the category/i }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/four options must be distinct/i),
    ).toBeInTheDocument();
  });

  it("rejects a non-http(s) image URL", () => {
    const onSubmit = vi.fn();
    render(
      <HostGenManualEntry themeKey="house" topic="Test" onSubmit={onSubmit} />,
    );
    for (let i = 0; i < 7; i++) {
      fillRow(i, {
        prompt: `Question prompt number ${i + 1}?`,
        options: [
          `Row ${i + 1} A`,
          `Row ${i + 1} B`,
          `Row ${i + 1} C`,
          `Row ${i + 1} D`,
        ],
      });
    }
    const imageInput = screen.getByLabelText(
      /^row 1 optional image url$/i,
    ) as HTMLInputElement;
    fireEvent.change(imageInput, { target: { value: "ftp://nope" } });
    fireEvent.click(
      screen.getByRole("button", { name: /lock the category/i }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/image url must start with http/i),
    ).toBeInTheDocument();
  });

  it("calls onCancel when 'Cancel' is clicked", () => {
    const onCancel = vi.fn();
    render(
      <HostGenManualEntry themeKey="house" topic="Test" onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server-side error message at the footer", () => {
    render(
      <HostGenManualEntry
        themeKey="house"
        errorMessage="Database is offline."
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/database is offline/i)).toBeInTheDocument();
  });
});

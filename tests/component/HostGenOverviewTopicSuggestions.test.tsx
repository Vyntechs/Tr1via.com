import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HostGenOverview } from "@/components/host/gen/HostGenOverview";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HostGenOverview player ideas", () => {
  it("renders real player ideas with a use action", () => {
    const onUseSuggestion = vi.fn();
    render(
      <HostGenOverview
        themeKey="july"
        topSuggestions={[{ name: "Pixar movies", count: 3 }]}
        onUseSuggestion={onUseSuggestion}
      />,
    );
    expect(screen.getByText(/player ideas/i)).toBeInTheDocument();
    expect(screen.getByText("Pixar movies")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /use pixar movies/i }));
    expect(onUseSuggestion).toHaveBeenCalledWith("Pixar movies");
  });

  it("renders a natural empty state", () => {
    render(<HostGenOverview themeKey="july" topSuggestions={[]} />);
    expect(screen.getByText(/no player ideas yet/i)).toBeInTheDocument();
  });

  it("does not render touched user-facing room copy", () => {
    render(<HostGenOverview themeKey="july" topSuggestions={[]} />);
    expect(screen.queryByText(/suggested by the room/i)).toBeNull();
    expect(screen.queryByText(/let the room pick/i)).toBeNull();
    expect(screen.queryByText(/player vote/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /open the room/i })).toBeNull();
  });
});

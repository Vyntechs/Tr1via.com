import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemedSection } from "@/components/marketing/ThemedSection";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

describe("ThemedSection", () => {
  it("paints itself in the theme's palette via inline vars (no-JS readable)", () => {
    const { container } = render(
      <ThemedSection themeKey="october" id="why">
        content
      </ThemedSection>,
    );
    const section = container.querySelector("section")!;
    expect(section.style.getPropertyValue("--paper")).toBe(TR1VIA_THEMES.october.paper);
    expect(section.style.getPropertyValue("--ink")).toBe(TR1VIA_THEMES.october.ink);
    expect(section.getAttribute("data-theme")).toBe("october");
    expect(section.getAttribute("data-ys-section")).toBe("october");
    expect(section.getAttribute("id")).toBe("why");
  });

  it("renders its children", () => {
    const { getByText } = render(<ThemedSection themeKey="june">hello</ThemedSection>);
    expect(getByText("hello")).toBeTruthy();
  });
});

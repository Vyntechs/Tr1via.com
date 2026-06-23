import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TriviaNightPage from "@/app/(marketing)/trivia-night/page";
import PricingPage from "@/app/(marketing)/pricing/page";
import { ThemeProvider } from "@/components/system/ThemeProvider";

describe("marketing structured data is server-rendered", () => {
  it("hub emits SoftwareApplication JSON-LD with the free + $4.99 offers", () => {
    // Page renders under the root ThemeProvider in prod; the toy needs it.
    const { container } = render(
      <ThemeProvider themeKey="june">
        <TriviaNightPage />
      </ThemeProvider>,
    );
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const json = JSON.parse(ld!.innerHTML);
    expect(json["@type"]).toBe("SoftwareApplication");
    const prices = json.offers.map((o: { price: string }) => o.price);
    expect(prices).toContain("0");
    expect(prices).toContain("4.99");
  });

  it("/pricing emits FAQPage JSON-LD built from the visible questions", () => {
    const { container } = render(<PricingPage />);
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const json = JSON.parse(ld!.innerHTML);
    expect(json["@type"]).toBe("FAQPage");
    expect(json.mainEntity.length).toBeGreaterThanOrEqual(4);
    expect(json.mainEntity[0]["@type"]).toBe("Question");
  });
});

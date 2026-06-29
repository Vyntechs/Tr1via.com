import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/system";
import { HostGenAuditSummary } from "@/components/host/gen/HostGenAuditSummary";

afterEach(cleanup);

describe("HostGenAuditSummary", () => {
  it("renders compact accepted, cost, image, and risk metrics", () => {
    render(
      <ThemeProvider themeKey="house">
        <HostGenAuditSummary
          summary={{
            acceptedCount: 20,
            generatedCount: 27,
            verifyPasses: 2,
            estimatedCostUsd: 0.1432,
            imageTargetCount: 20,
            imageAttachedCount: 18,
            riskFlagCount: 3,
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("20 accepted from 27 candidates")).toBeInTheDocument();
    expect(screen.getByText("2 verification passes")).toBeInTheDocument();
    expect(screen.getByText("Estimated AI cost: $0.14")).toBeInTheDocument();
    expect(screen.getByText("Images: 20 attempted, 18 attached")).toBeInTheDocument();
    expect(screen.getByText("3 wording flags to review")).toBeInTheDocument();
  });
});

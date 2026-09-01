import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatCard, compactNumber } from "@/components/dashboard/stat-card";

describe("compactNumber", () => {
  it("keeps small numbers exact and groups thousands", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(42)).toBe("42");
    expect(compactNumber(1284)).toBe("1,284");
    expect(compactNumber(9999)).toBe("9,999");
  });

  it("compacts only once the digits stop being readable", () => {
    expect(compactNumber(10_000)).toBe("10.0K");
    expect(compactNumber(12_900)).toBe("12.9K");
    expect(compactNumber(1_400_000)).toBe("1.4M");
  });

  it("handles negatives and non-finite values", () => {
    expect(compactNumber(-12_900)).toBe("-12.9K");
    expect(compactNumber(Number.NaN)).toBe("-");
    expect(compactNumber(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("StatCard", () => {
  it("shows the label, the compacted value and the hint", () => {
    render(<StatCard label="Awaiting review" value={12900} hint="On this page" />);

    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText("12.9K")).toBeInTheDocument();
    expect(screen.getByText("On this page")).toBeInTheDocument();
  });

  it("passes a string value through untouched", () => {
    render(<StatCard label="Average time to resolve" value="5.2h" />);
    expect(screen.getByText("5.2h")).toBeInTheDocument();
  });

  it("becomes a link to the filtered list when given a target", () => {
    render(<StatCard label="Critical open" value={3} href="/admin/reports?priority=CRITICAL" />);

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/reports?priority=CRITICAL",
    );
  });

  it("stays plain text when there is nothing to link to", () => {
    render(<StatCard label="In progress" value={4} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

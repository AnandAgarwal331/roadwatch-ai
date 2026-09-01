import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clamp,
  formatDistance,
  formatDuration,
  formatPercent,
  formatRate,
  humanise,
  initials,
  timeAgo,
} from "@/lib/utils";

describe("humanise", () => {
  it("turns an enum value into a sentence", () => {
    expect(humanise("CRACKED_ROAD")).toBe("Cracked road");
    expect(humanise("POTHOLE")).toBe("Pothole");
  });

  it("returns an empty string for a missing value rather than 'undefined'", () => {
    expect(humanise(null)).toBe("");
    expect(humanise(undefined)).toBe("");
    expect(humanise("")).toBe("");
  });
});

describe("formatDuration", () => {
  it("uses minutes below an hour", () => {
    expect(formatDuration(0.5)).toBe("30 min");
  });

  it("uses hours up to two days", () => {
    expect(formatDuration(5.24)).toBe("5.2h");
    expect(formatDuration(47.9)).toBe("47.9h");
  });

  it("switches to days at 48 hours", () => {
    expect(formatDuration(48)).toBe("2.0 days");
    expect(formatDuration(60)).toBe("2.5 days");
  });

  it("distinguishes 'no data' from zero", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(undefined)).toBe("-");
    expect(formatDuration(0)).toBe("0 min");
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre and kilometres above", () => {
    expect(formatDistance(42.4)).toBe("42m");
    expect(formatDistance(999)).toBe("999m");
    expect(formatDistance(1000)).toBe("1.0km");
    expect(formatDistance(2500)).toBe("2.5km");
  });

  it("distinguishes 'no data' from zero", () => {
    expect(formatDistance(null)).toBe("-");
    expect(formatDistance(0)).toBe("0m");
  });
});

describe("formatPercent", () => {
  it("renders a 0-1 ratio as a percentage", () => {
    expect(formatPercent(0.847)).toBe("85%");
    expect(formatPercent(0.847, 1)).toBe("84.7%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatRate", () => {
  it("renders an already-scaled value without scaling it again", () => {
    // The analytics endpoint returns resolution_rate as 17.2, meaning 17.2%.
    // Routing it through formatPercent would render "1720%".
    expect(formatRate(17.2)).toBe("17%");
    expect(formatRate(17.2, 1)).toBe("17.2%");
    expect(formatRate(100)).toBe("100%");
    expect(formatRate(66.7)).toBe("67%");
  });

  it("treats null as 'not enough data', which is not zero", () => {
    expect(formatRate(null)).toBe("-");
    expect(formatRate(undefined)).toBe("-");
    expect(formatRate(0)).toBe("0%");
  });

  it("differs from formatPercent, which is the whole point of having both", () => {
    expect(formatRate(50)).toBe("50%");
    expect(formatPercent(50)).toBe("5000%");
  });
});

describe("clamp", () => {
  it("holds a value inside the range", () => {
    expect(clamp(150)).toBe(100);
    expect(clamp(-10)).toBe(0);
    expect(clamp(42)).toBe(42);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe("initials", () => {
  it("takes at most the first two names", () => {
    expect(initials("Deepa Menon")).toBe("DM");
    expect(initials("Priya Sharma Kumar")).toBe("PS");
    expect(initials("Ravi")).toBe("R");
  });

  it("survives extra whitespace and an empty name", () => {
    expect(initials("  Ravi   Kumar  ")).toBe("RK");
    expect(initials("")).toBe("");
  });
});

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("describes recent times relatively and older ones as a date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    expect(timeAgo(new Date("2026-06-15T11:59:40Z"))).toBe("just now");
    expect(timeAgo(new Date("2026-06-15T11:30:00Z"))).toBe("30m ago");
    expect(timeAgo(new Date("2026-06-15T07:00:00Z"))).toBe("5h ago");
    expect(timeAgo(new Date("2026-06-10T12:00:00Z"))).toBe("5d ago");
    // Past a month it stops counting and names the day.
    expect(timeAgo(new Date("2026-01-10T12:00:00Z"))).toContain("2026");
  });

  it("returns a dash for missing or unparseable values", () => {
    expect(timeAgo(null)).toBe("-");
    expect(timeAgo(undefined)).toBe("-");
    expect(timeAgo("not a date")).toBe("-");
  });
});

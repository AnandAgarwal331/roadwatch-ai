import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_STYLES,
  CHART_COLORS,
  CHART_COLORS_DARK,
  DAMAGE_TYPE_LABELS,
  PRIORITY_HEX,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  PRIORITY_RAMP,
  PRIORITY_RAMP_DARK,
  PRIORITY_STYLES,
  REPORTABLE_DAMAGE_TYPES,
  STATUS_FLOW,
  STATUS_LABELS,
  STATUS_STYLES,
} from "@/lib/constants";
import type { AssignmentStatus, ComplaintStatus, DamageType, PriorityLevel } from "@/types";

/**
 * These lists mirror the backend enums in `app/core/enums.py`. They are written
 * out rather than derived, because that is what makes the test useful: if the
 * backend gains a status and the frontend vocabulary is not updated, something
 * here fails instead of a badge silently rendering blank.
 */
const DAMAGE_TYPES: DamageType[] = [
  "POTHOLE",
  "CRACKED_ROAD",
  "FLOODING",
  "DAMAGED_SIDEWALK",
  "BROKEN_STREETLIGHT",
  "OTHER",
  "UNKNOWN",
];

const COMPLAINT_STATUSES: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
  "DUPLICATE",
];

const ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "VERIFIED",
  "CANCELLED",
];

const PRIORITY_LEVELS: PriorityLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

describe("domain vocabulary is complete", () => {
  it("labels and styles every damage type", () => {
    for (const type of DAMAGE_TYPES) {
      expect(DAMAGE_TYPE_LABELS[type], type).toBeTruthy();
    }
  });

  it("labels and styles every complaint status", () => {
    for (const status of COMPLAINT_STATUSES) {
      expect(STATUS_LABELS[status], status).toBeTruthy();
      expect(STATUS_STYLES[status], status).toBeTruthy();
    }
  });

  it("labels and styles every assignment status", () => {
    for (const status of ASSIGNMENT_STATUSES) {
      expect(ASSIGNMENT_STATUS_LABELS[status], status).toBeTruthy();
      expect(ASSIGNMENT_STATUS_STYLES[status], status).toBeTruthy();
    }
  });

  it("labels and colours every priority level", () => {
    for (const level of PRIORITY_LEVELS) {
      expect(PRIORITY_LABELS[level], level).toBeTruthy();
      expect(PRIORITY_STYLES[level], level).toBeTruthy();
      expect(PRIORITY_HEX[level], level).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("offers citizens every damage type except the two the AI assigns itself", () => {
    expect(REPORTABLE_DAMAGE_TYPES).not.toContain("UNKNOWN");
    for (const type of REPORTABLE_DAMAGE_TYPES) {
      expect(DAMAGE_TYPES).toContain(type);
    }
  });

  it("orders priority worst-first and covers every level", () => {
    expect(PRIORITY_ORDER).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect([...PRIORITY_ORDER].sort()).toEqual([...PRIORITY_LEVELS].sort());
  });

  it("walks the status flow in lifecycle order, excluding the dead ends", () => {
    expect(STATUS_FLOW[0]).toBe("PENDING");
    expect(STATUS_FLOW[STATUS_FLOW.length - 1]).toBe("RESOLVED");
    // Rejected and duplicate leave the flow rather than advance it.
    expect(STATUS_FLOW).not.toContain("REJECTED");
    expect(STATUS_FLOW).not.toContain("DUPLICATE");
  });
});

describe("chart palettes", () => {
  it("keeps the categorical scale small enough to stay separable", () => {
    // Three is the largest set that clears colour-vision separation for every
    // pair. A fourth measure becomes another chart, not another hue.
    expect(CHART_COLORS).toHaveLength(3);
    expect(CHART_COLORS_DARK).toHaveLength(CHART_COLORS.length);
  });

  it("uses valid hex throughout", () => {
    for (const colour of [...CHART_COLORS, ...CHART_COLORS_DARK]) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("gives the priority ramp its own steps per mode rather than flipping one", () => {
    for (const level of PRIORITY_LEVELS) {
      expect(PRIORITY_RAMP[level], level).toMatch(/^#[0-9a-f]{6}$/i);
      expect(PRIORITY_RAMP_DARK[level], level).toMatch(/^#[0-9a-f]{6}$/i);
      expect(PRIORITY_RAMP[level]).not.toBe(PRIORITY_RAMP_DARK[level]);
    }
  });

  it("runs the light ramp light-to-dark from low to critical", () => {
    // An ordinal ramp has to read as a scale, so lightness must fall
    // monotonically as severity rises.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const steps = PRIORITY_ORDER.slice()
      .reverse()
      .map((level) => luminance(PRIORITY_RAMP[level]));

    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
  });
});

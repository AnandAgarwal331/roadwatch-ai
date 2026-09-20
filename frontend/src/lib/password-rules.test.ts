import { describe, expect, it } from "vitest";

import { passwordProblem } from "./password-rules";

describe("passwordProblem", () => {
  it("accepts a password with letters and digits in range", () => {
    expect(passwordProblem("Roads2026")).toBeNull();
  });

  it("names the first problem it finds", () => {
    expect(passwordProblem("a1")).toMatch(/at least 8/);
    expect(passwordProblem("12345678")).toMatch(/letter/);
    expect(passwordProblem("abcdefgh")).toMatch(/number/);
    expect(passwordProblem("a1".repeat(40))).toMatch(/at most 72/);
  });
});

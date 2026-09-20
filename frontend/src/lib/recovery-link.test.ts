import { describe, expect, it } from "vitest";

import { parseRecoveryLink } from "./recovery-link";

describe("parseRecoveryLink", () => {
  it("extracts the token from a valid recovery link", () => {
    expect(parseRecoveryLink("#access_token=abc.def&expires_in=3600&type=recovery")).toEqual({
      status: "token",
      accessToken: "abc.def",
    });
  });

  it("does not treat a non-recovery token (e.g. a magic link) as a reset token", () => {
    expect(parseRecoveryLink("#access_token=abc&type=signup").status).toBe("none");
  });

  it("reports an expired link in plain words", () => {
    const result = parseRecoveryLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    expect(result).toEqual({ status: "error", message: "This reset link has expired or was already used." });
  });

  it("falls back to the provider's description for other errors", () => {
    expect(parseRecoveryLink("#error=server_error&error_description=Something+broke")).toEqual({
      status: "error",
      message: "Something broke",
    });
  });

  it("returns none for an empty or unrelated fragment", () => {
    expect(parseRecoveryLink("").status).toBe("none");
    expect(parseRecoveryLink("#section-2").status).toBe("none");
  });
});

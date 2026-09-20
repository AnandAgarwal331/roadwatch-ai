/**
 * Reads what Supabase Auth put in the URL fragment when someone follows a
 * password-reset email link. The fragment never reaches the server, so this
 * runs in the browser: a valid link carries `access_token` and
 * `type=recovery`; an expired or reused one carries `error_code`.
 */
export type RecoveryLink =
  | { status: "token"; accessToken: string }
  | { status: "error"; message: string }
  | { status: "none" };

export function parseRecoveryLink(hash: string): RecoveryLink {
  const params = new URLSearchParams(hash.replace(/^#/, ""));

  const errorCode = params.get("error_code");
  if (errorCode || params.get("error")) {
    return {
      status: "error",
      message:
        errorCode === "otp_expired"
          ? "This reset link has expired or was already used."
          : (params.get("error_description") ?? "This reset link is not valid."),
    };
  }

  const accessToken = params.get("access_token");
  if (accessToken && params.get("type") === "recovery") return { status: "token", accessToken };

  return { status: "none" };
}

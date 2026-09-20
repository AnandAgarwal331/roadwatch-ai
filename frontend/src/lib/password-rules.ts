/**
 * The password rule shared by the reset form (browser) and the reset route
 * (server), mirroring the register form and the Edge Function's own check.
 * Returns a message for the first problem, or null if the password is fine.
 */
export function passwordProblem(value: string): string | null {
  if (value.length < 8) return "Use at least 8 characters";
  if (value.length > 72) return "Use at most 72 characters";
  if (!/[A-Za-z]/.test(value)) return "Include at least one letter";
  if (!/\d/.test(value)) return "Include at least one number";
  return null;
}

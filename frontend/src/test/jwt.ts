export const TEST_USER_ID = "3f2b1c9e-8a44-4d0e-9b1a-6c5d7e8f9a01";

/** An unsigned JWT-shaped token with the given expiry, for tests that only read its claims. Every call yields a distinct token
 * (caches are keyed by token), even within the same second. */
export function fakeJwt(secondsFromNow: number, claims: Record<string, unknown> = {}): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  return `${encode({ alg: "none" })}.${encode({ sub: TEST_USER_ID, exp, jti: crypto.randomUUID(), ...claims })}.signature`;
}

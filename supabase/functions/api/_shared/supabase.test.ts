// currentUserId() checks a token's signature locally against the project's
// public signing keys instead of asking the auth server. These tests do that
// for real - a fresh ES256 key pair signs the tokens, and a stubbed fetch
// serves the matching public key the way the project's JWKS endpoint does -
// so what is verified is the actual verification path, not a mock of it.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_URL", "https://project.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "test-publishable-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { currentUserId } = await import("./supabase.ts");

const KID = "test-key-1";
const USER_ID = "3f2b1c9e-8a44-4d0e-9b1a-6c5d7e8f9a01";

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function newKeyPair() {
  return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function sign(privateKey: CryptoKey, claims: Record<string, unknown>, kid = KID): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const payload = b64url(JSON.stringify(claims));
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(`${header}.${payload}`)),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

const trusted = await newKeyPair();
const untrusted = await newKeyPair();
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", trusted.publicKey)), kid: KID, alg: "ES256", use: "sig", key_ops: ["verify"] };

const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({ sub: USER_ID, role: "authenticated", aud: "authenticated", exp: now() + 3600, iat: now() });

/** Serves the project's public keys and records every URL asked for. */
async function withProject(body: (requested: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (url.endsWith("/.well-known/jwks.json")) {
      return Promise.resolve(new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response("{}", { status: 500 }));
  };
  try {
    await body(requested);
  } finally {
    globalThis.fetch = original;
  }
}

function requestWith(token?: string): Request {
  return new Request("http://localhost/api/complaints", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

Deno.test("a token signed with the project's key identifies its user", async () => {
  await withProject(async () => {
    const token = await sign(trusted.privateKey, goodClaims());
    assertEquals(await currentUserId(requestWith(token)), USER_ID);
  });
});

Deno.test("verifying a token never calls the auth server's user endpoint", async () => {
  await withProject(async (requested) => {
    await currentUserId(requestWith(await sign(trusted.privateKey, goodClaims())));
    await currentUserId(requestWith(await sign(trusted.privateKey, goodClaims())));
    assertEquals(requested.filter((url) => url.includes("/auth/v1/user")), []);
  });
});

Deno.test("the public keys are fetched once and reused, not once per request", async () => {
  await withProject(async (requested) => {
    for (let i = 0; i < 4; i++) await currentUserId(requestWith(await sign(trusted.privateKey, goodClaims())));
    assertEquals(requested.filter((url) => url.endsWith("/.well-known/jwks.json")).length <= 1, true);
  });
});

Deno.test("an expired token is rejected", async () => {
  await withProject(async () => {
    const token = await sign(trusted.privateKey, { ...goodClaims(), exp: now() - 60 });
    assertEquals(await currentUserId(requestWith(token)), null);
  });
});

Deno.test("a token signed with some other key is rejected", async () => {
  await withProject(async () => {
    const forged = await sign(untrusted.privateKey, goodClaims());
    assertEquals(await currentUserId(requestWith(forged)), null);
  });
});

Deno.test("a token with its payload altered after signing is rejected", async () => {
  await withProject(async () => {
    const [header, , signature] = (await sign(trusted.privateKey, goodClaims())).split(".");
    const swapped = b64url(JSON.stringify({ ...goodClaims(), sub: "00000000-0000-4000-8000-000000000000" }));
    assertEquals(await currentUserId(requestWith(`${header}.${swapped}.${signature}`)), null);
  });
});

Deno.test("a request with no credentials, or something that is not a token, has no user", async () => {
  await withProject(async () => {
    assertEquals(await currentUserId(requestWith()), null);
    assertEquals(await currentUserId(requestWith("not-a-jwt")), null);
    assertEquals(await currentUserId(new Request("http://localhost/", { headers: { Authorization: "Basic abc" } })), null);
  });
});

Deno.test("a valid signature without a subject does not identify anyone", async () => {
  await withProject(async () => {
    const { sub: _omitted, ...withoutSub } = goodClaims();
    assertEquals(await currentUserId(requestWith(await sign(trusted.privateKey, withoutSub))), null);
  });
});

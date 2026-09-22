// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetProfile, rememberProfile } from "@/lib/session";
import { sharedCache } from "@/lib/ttl-cache";
import { fakeJwt, TEST_USER_ID } from "@/test/jwt";
import type { User } from "@/types";

import { GET, PATCH } from "./route";

const fetchMock = vi.fn();

function call(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  const request = new NextRequest(`http://localhost:3000/api/proxy/${path}`, {
    headers: cookie ? { cookie } : {},
  });
  return GET(request, { params: Promise.resolve({ path: path.split("/") }) });
}

function backendCall() {
  // The first fetch is either the token refresh or the backend call itself;
  // find the one aimed at the Edge Function.
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/functions/v1/"));
  return call as [string, { headers: Headers }] | undefined;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API proxy", () => {
  it("attaches the session token as a bearer header, and never forwards the cookie", async () => {
    const token = fakeJwt(3600);
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));

    await call("complaints", { rw_session: token, rw_refresh: "r1" });

    const [url, init] = backendCall()!;
    expect(url).toBe("https://project.supabase.co/functions/v1/api/complaints");
    expect(init.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(init.headers.get("cookie")).toBeNull();
  });

  it("calls the backend without credentials for a signed-out visitor", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));

    await call("public/stats");

    const [, init] = backendCall()!;
    expect(init.headers.get("authorization")).toBeNull();
    expect(init.headers.get("apikey")).toBe("test-publishable-key");
  });

  it("renews an expired token before forwarding, and hands the new cookies to the browser", async () => {
    const fresh = fakeJwt(3600);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: fresh, refresh_token: "r2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));

    const response = await call("complaints/mine", { rw_session: fakeJwt(-30), rw_refresh: "r1", rw_role: "CITIZEN" });

    expect(backendCall()![1].headers.get("authorization")).toBe(`Bearer ${fresh}`);
    expect(response.status).toBe(200);
    expect(response.cookies.get("rw_session")?.value).toBe(fresh);
    expect(response.cookies.get("rw_refresh")?.value).toBe("r2");
  });

  it("clears the cookies, and calls the backend signed out, when the refresh token is revoked", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));

    const response = await call("complaints/mine", { rw_session: fakeJwt(-30), rw_refresh: "revoked" });

    expect(backendCall()![1].headers.get("authorization")).toBeNull();
    expect(response.status).toBe(401);
    expect(response.cookies.get("rw_session")?.maxAge).toBe(0);
    expect(response.cookies.get("rw_refresh")?.maxAge).toBe(0);
  });

  it("reports an unreachable backend as 503 without ending the session", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const response = await call("complaints", { rw_session: fakeJwt(3600), rw_refresh: "r1" });

    expect(response.status).toBe(503);
    expect(response.cookies.get("rw_session")).toBeUndefined();
  });
});

describe("API proxy: caching for signed-out visitors", () => {
  // The cache outlives a single test, so each test uses a path of its own.
  it("answers a repeat request from memory instead of asking the backend again", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const first = await call("cache-test/repeat");
    const second = await call("cache-test/repeat");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.headers.get("x-rw-cache")).toBe("miss");
    expect(second.headers.get("x-rw-cache")).toBe("hit");
    expect(await second.json()).toEqual({ ok: true });
  });

  it("keeps different addresses and query strings apart", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"page":1}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"page":2}', { status: 200 }));

    const one = await (await call("cache-test/list?page=1")).json();
    const two = await (await call("cache-test/list?page=2")).json();

    expect(one).toEqual({ page: 1 });
    expect(two).toEqual({ page: 2 });
  });

  it("never caches an error, so the next visitor gets a fresh try", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":"boom"}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const failed = await call("cache-test/error");
    const retried = await call("cache-test/error");

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never serves a signed-in user from the shared cache, or stores their answers in it", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"whose":"anonymous"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"whose":"signed-in user"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"whose":"anonymous"}', { status: 200 }));

    await call("cache-test/private");
    const signedIn = await call("cache-test/private", { rw_session: fakeJwt(3600), rw_refresh: "r1" });
    expect(await signedIn.json()).toEqual({ whose: "signed-in user" });
    expect(signedIn.headers.get("x-rw-cache")).toBeNull();

    // A later anonymous visitor still gets the anonymous answer.
    const later = await call("cache-test/private");
    expect(await later.json()).toEqual({ whose: "anonymous" });
    expect(later.headers.get("x-rw-cache")).toBe("hit");
  });

  it("relays a backend outage as 503 and remembers nothing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(new Response("{}", { status: 200 }));

    expect((await call("cache-test/outage")).status).toBe(503);
    expect((await call("cache-test/outage")).status).toBe(200);
  });
});

describe("API proxy: the remembered profile", () => {
  const PROFILE: User = {
    id: TEST_USER_ID,
    email: "a@b.co",
    full_name: "Asha",
    phone: null,
    role: "CITIZEN",
    is_active: true,
    team_id: null,
    created_at: "2026-09-01T00:00:00Z",
  };
  const profiles = () => sharedCache<User>("profiles", { maxEntries: 500, freshMs: 30_000, staleMs: 0 });

  async function patch(path: string, token: string) {
    const request = new NextRequest(`http://localhost:3000/api/proxy/${path}`, {
      method: "PATCH",
      headers: { cookie: `rw_session=${token}; rw_refresh=r1`, "content-type": "application/json" },
      body: "{}",
    });
    return PATCH(request, { params: Promise.resolve({ path: path.split("/") }) });
  }

  it("is dropped when the user edits their own account, so the next page shows the change", async () => {
    const token = fakeJwt(3600);
    rememberProfile(token, PROFILE);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await patch("auth/me", token);

    expect(profiles().get(token)).toBeUndefined();
  });

  it("is kept when that edit fails, or the request was about something else", async () => {
    const token = fakeJwt(3600);
    rememberProfile(token, PROFILE);

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    await patch("auth/me", token);
    expect(profiles().get(token)).toBeDefined();

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await patch("complaints/12", token);
    expect(profiles().get(token)).toBeDefined();

    forgetProfile(token);
  });
});

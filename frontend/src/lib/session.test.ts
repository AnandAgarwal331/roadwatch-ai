// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeJwt, TEST_USER_ID } from "@/test/jwt";
import type { User } from "@/types";

const cookieJar = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieJar.values ? { value: cookieJar.values[name] } : undefined) }),
}));

import { fetchProfile, forgetProfile, getCurrentUser, jwtExpiry, publicFetch, rememberProfile, resolveSession } from "./session";

const fetchMock = vi.fn();

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

function refreshResponds(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  cookieJar.values = {};
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jwtExpiry", () => {
  it("reads the exp claim", () => {
    const token = fakeJwt(600);
    expect(jwtExpiry(token)).toBeGreaterThan(Date.now() / 1000 + 590);
  });

  it("returns null for anything that is not a readable JWT", () => {
    expect(jwtExpiry("")).toBeNull();
    expect(jwtExpiry("not-a-jwt")).toBeNull();
    expect(jwtExpiry("a.%%%.c")).toBeNull();
  });
});

describe("resolveSession", () => {
  it("reports nobody signed in when there are no cookies", async () => {
    expect(await resolveSession(undefined, undefined)).toEqual({ state: "none" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a token that is still good without calling Supabase", async () => {
    const token = fakeJwt(3600);
    expect(await resolveSession(token, "refresh-1")).toEqual({
      state: "valid",
      accessToken: token,
      refreshToken: "refresh-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renews a token that has expired", async () => {
    const fresh = fakeJwt(3600);
    refreshResponds(200, { access_token: fresh, refresh_token: "refresh-2" });

    const session = await resolveSession(fakeJwt(-10), "refresh-1");

    expect(session).toEqual({ state: "renewed", accessToken: fresh, refreshToken: "refresh-2" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/auth/v1/token?grant_type=refresh_token");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "refresh-1" });
    expect(init.headers.apikey).toBe("test-publishable-key");
  });

  it("renews a token that is about to expire, not only one that already has", async () => {
    refreshResponds(200, { access_token: fakeJwt(3600), refresh_token: "refresh-2" });
    expect((await resolveSession(fakeJwt(20), "refresh-1")).state).toBe("renewed");
  });

  it("renews when only the refresh cookie is left", async () => {
    refreshResponds(200, { access_token: fakeJwt(3600), refresh_token: "refresh-2" });
    expect((await resolveSession(undefined, "refresh-1")).state).toBe("renewed");
  });

  it("ends the session when the refresh token is rejected", async () => {
    refreshResponds(400, { error_code: "refresh_token_not_found" });
    expect(await resolveSession(fakeJwt(-10), "revoked")).toEqual({ state: "expired" });
  });

  it("keeps the session when Supabase cannot be reached", async () => {
    const stale = fakeJwt(-10);
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await resolveSession(stale, "refresh-1")).toEqual({
      state: "unavailable",
      accessToken: stale,
    });
  });

  it("keeps the session when Supabase is throttling or failing", async () => {
    refreshResponds(429);
    expect((await resolveSession(fakeJwt(-10), "refresh-1")).state).toBe("unavailable");
    refreshResponds(503);
    expect((await resolveSession(fakeJwt(-10), "refresh-1")).state).toBe("unavailable");
  });

  it("treats a malformed refresh reply as unavailable rather than signing anyone in", async () => {
    refreshResponds(200, { access_token: 42 });
    expect((await resolveSession(fakeJwt(-10), "refresh-1")).state).toBe("unavailable");
  });

  it("ends a legacy session with no refresh cookie once its token is dead", async () => {
    expect(await resolveSession(fakeJwt(-10), undefined)).toEqual({ state: "expired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still accepts a legacy token in its last minute", async () => {
    const token = fakeJwt(20);
    expect((await resolveSession(token, undefined)).state).toBe("valid");
  });

  it("shares one refresh between simultaneous requests", async () => {
    refreshResponds(200, { access_token: fakeJwt(3600), refresh_token: "refresh-2" });

    const results = await Promise.all([
      resolveSession(fakeJwt(-10), "refresh-1"),
      resolveSession(fakeJwt(-10), "refresh-1"),
      resolveSession(fakeJwt(-10), "refresh-1"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.state === "renewed")).toBe(true);
  });
});

describe("fetchProfile", () => {
  it("asks the database for the token's own row, as the token's owner", async () => {
    const token = fakeJwt(3600);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(PROFILE), { status: 200 }));

    expect(await fetchProfile(token)).toEqual(PROFILE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://project.supabase.co/rest/v1/profiles?select=*&id=eq.${TEST_USER_ID}`);
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    expect(init.headers.apikey).toBe("test-publishable-key");
    expect(init.headers.Accept).toBe("application/vnd.pgrst.object+json");
    expect(init.cache).toBe("no-store");
  });

  it("returns null when the database rejects the token or has no such row", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await fetchProfile(fakeJwt(-30))).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 406 }));
    expect(await fetchProfile(fakeJwt(3600))).toBeNull();
  });

  it("returns null when the database cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await fetchProfile(fakeJwt(3600))).toBeNull();
  });

  it("never puts anything but a UUID into the query", async () => {
    for (const sub of ["1;drop table profiles", "a&select=*", "", 42]) {
      expect(await fetchProfile(fakeJwt(3600, { sub }))).toBeNull();
    }
    expect(await fetchProfile("not-a-jwt")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getCurrentUser", () => {
  it("is null without a session cookie, without calling anyone", async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the signed-in user", async () => {
    cookieJar.values = { rw_session: fakeJwt(3600) };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(PROFILE), { status: 200 }));

    expect(await getCurrentUser()).toEqual(PROFILE);
  });

  it("asks the database once for a user, not on every page they open", async () => {
    cookieJar.values = { rw_session: fakeJwt(3600) };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(PROFILE), { status: 200 }));

    await getCurrentUser();
    await getCurrentUser();
    await getCurrentUser();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the profile that sign-in already loaded, without asking again", async () => {
    const token = fakeJwt(3600);
    cookieJar.values = { rw_session: token };
    rememberProfile(token, PROFILE);

    expect(await getCurrentUser()).toEqual(PROFILE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks again once the remembered profile is forgotten", async () => {
    const token = fakeJwt(3600);
    cookieJar.values = { rw_session: token };
    rememberProfile(token, PROFILE);
    forgetProfile(token);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...PROFILE, full_name: "New Name" }), { status: 200 }));

    expect((await getCurrentUser())?.full_name).toBe("New Name");
  });

  it("does not remember a failed lookup", async () => {
    cookieJar.values = { rw_session: fakeJwt(3600) };
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect(await getCurrentUser()).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(PROFILE), { status: 200 }));
    expect(await getCurrentUser()).toEqual(PROFILE);
  });

  it("treats a deactivated account as signed out", async () => {
    cookieJar.values = { rw_session: fakeJwt(3600) };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...PROFILE, is_active: false }), { status: 200 }));

    expect(await getCurrentUser()).toBeNull();
  });

  it("is null when the token is no longer accepted", async () => {
    cookieJar.values = { rw_session: fakeJwt(-30) };
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    expect(await getCurrentUser()).toBeNull();
  });
});

describe("publicFetch", () => {
  it("fetches public data without any session, and remembers it", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"total_reports":5}', { status: 200 }));

    expect(await publicFetch("/api/stats/public-test-a")).toEqual({ total_reports: 5 });
    expect(await publicFetch("/api/stats/public-test-a")).toEqual({ total_reports: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/functions/v1/api/stats/public-test-a");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers.apikey).toBe("test-publishable-key");
  });

  it("returns null on a failure and does not remember it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await publicFetch("/api/stats/public-test-b")).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response('{"total_reports":7}', { status: 200 }));
    expect(await publicFetch("/api/stats/public-test-b")).toEqual({ total_reports: 7 });
  });

  it("returns null when the backend cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await publicFetch("/api/stats/public-test-c")).toBeNull();
  });
});

// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeJwt } from "@/test/jwt";

import { proxy } from "./proxy";

const fetchMock = vi.fn();

function request(path: string, cookies: Record<string, string> = {}) {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: header ? { cookie: header } : {},
  });
}

function signedIn(role: string) {
  return { rw_session: fakeJwt(3600), rw_refresh: "refresh-1", rw_role: role };
}

/** Where a redirect points, as a path + query, or null if the response was not a redirect. */
function redirectTarget(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return url.pathname + url.search;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("route guard: signed-out visitors", () => {
  it.each(["/report", "/my-reports", "/profile", "/admin", "/admin/queue", "/team", "/team/jobs/3"])(
    "sends %s to the login page and remembers where they were going",
    async (path) => {
      const response = await proxy(request(path));
      expect(redirectTarget(response)).toBe(`/login?next=${encodeURIComponent(path)}`);
    },
  );

  it("keeps the query string of the page they wanted", async () => {
    const response = await proxy(request("/admin/queue?status=PENDING"));
    expect(redirectTarget(response)).toBe(`/login?next=${encodeURIComponent("/admin/queue?status=PENDING")}`);
  });

  it.each(["/", "/map", "/reports/12", "/login", "/register"])("lets them see public page %s", async (path) => {
    const response = await proxy(request(path));
    expect(redirectTarget(response)).toBeNull();
    expect(response.status).toBe(200);
  });
});

describe("route guard: roles", () => {
  it("lets a citizen into the citizen pages", async () => {
    for (const path of ["/report", "/my-reports", "/profile"]) {
      expect(redirectTarget(await proxy(request(path, signedIn("CITIZEN"))))).toBeNull();
    }
  });

  it("keeps a citizen out of the admin and crew areas", async () => {
    expect(redirectTarget(await proxy(request("/admin", signedIn("CITIZEN"))))).toBe("/");
    expect(redirectTarget(await proxy(request("/team", signedIn("CITIZEN"))))).toBe("/");
  });

  it("keeps a repair team out of the admin area, and sends them to their own home", async () => {
    expect(redirectTarget(await proxy(request("/admin/teams", signedIn("REPAIR_TEAM"))))).toBe("/team");
  });

  it("lets a repair team into the crew console", async () => {
    expect(redirectTarget(await proxy(request("/team", signedIn("REPAIR_TEAM"))))).toBeNull();
  });

  it("lets an admin into both the admin and crew areas", async () => {
    expect(redirectTarget(await proxy(request("/admin", signedIn("ADMIN"))))).toBeNull();
    expect(redirectTarget(await proxy(request("/team", signedIn("ADMIN"))))).toBeNull();
  });

  it("treats a missing or unknown role like a citizen", async () => {
    const cookies = { rw_session: fakeJwt(3600), rw_refresh: "r", rw_role: "SUPERUSER" };
    expect(redirectTarget(await proxy(request("/admin", cookies)))).toBe("/");
    expect(redirectTarget(await proxy(request("/admin", { rw_session: fakeJwt(3600) })))).toBe("/");
  });

  it("does not match a path that merely starts with a protected word", async () => {
    // "/administration" is not "/admin" or under it.
    expect(redirectTarget(await proxy(request("/administration")))).toBeNull();
  });
});

describe("route guard: expired access tokens", () => {
  it("renews the token and lets the user carry on, writing the new cookies", async () => {
    const fresh = fakeJwt(3600);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: fresh, refresh_token: "refresh-2" }), { status: 200 }),
    );

    const response = await proxy(
      request("/my-reports", { rw_session: fakeJwt(-30), rw_refresh: "refresh-1", rw_role: "CITIZEN" }),
    );

    expect(redirectTarget(response)).toBeNull();
    expect(response.cookies.get("rw_session")?.value).toBe(fresh);
    expect(response.cookies.get("rw_refresh")?.value).toBe("refresh-2");
    expect(response.cookies.get("rw_role")?.value).toBe("CITIZEN");
    // The page that renders next must see the new token, not the expired one.
    expect(response.headers.get("x-middleware-request-cookie")).toContain(`rw_session=${fresh}`);
  });

  it("renews before the role check, so an expired admin is not bounced", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: fakeJwt(3600), refresh_token: "refresh-2" }), { status: 200 }),
    );
    const response = await proxy(
      request("/admin", { rw_session: fakeJwt(-30), rw_refresh: "refresh-1", rw_role: "ADMIN" }),
    );
    expect(redirectTarget(response)).toBeNull();
  });

  it("sends the user to log in and clears their cookies when the refresh token is revoked", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));

    const response = await proxy(
      request("/my-reports", { rw_session: fakeJwt(-30), rw_refresh: "revoked", rw_role: "CITIZEN" }),
    );

    expect(redirectTarget(response)).toBe(`/login?next=${encodeURIComponent("/my-reports")}`);
    for (const name of ["rw_session", "rw_refresh", "rw_role"]) {
      expect(response.cookies.get(name)?.value).toBe("");
      expect(response.cookies.get(name)?.maxAge).toBe(0);
    }
  });

  it("clears cookies on a public page too, so the header stops showing a signed-in user", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const response = await proxy(
      request("/", { rw_session: fakeJwt(-30), rw_refresh: "revoked", rw_role: "CITIZEN" }),
    );
    expect(redirectTarget(response)).toBeNull();
    expect(response.cookies.get("rw_session")?.maxAge).toBe(0);
  });

  it("does not sign anyone out just because Supabase is briefly unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const response = await proxy(
      request("/my-reports", { rw_session: fakeJwt(-30), rw_refresh: "refresh-1", rw_role: "CITIZEN" }),
    );
    expect(redirectTarget(response)).toBeNull();
    expect(response.cookies.get("rw_session")).toBeUndefined();
  });
});

// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/session-policy";
import { fakeJwt, TEST_USER_ID } from "@/test/jwt";

import { POST } from "./route";

const fetchMock = vi.fn();

const PROFILE = {
  id: TEST_USER_ID,
  email: "a@b.co",
  full_name: "Asha",
  phone: null,
  role: "CITIZEN",
  is_active: true,
  team_id: null,
  created_at: "2026-09-01T00:00:00Z",
};

function call(action: string, body?: unknown, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  const request = new NextRequest(`http://localhost:3000/api/auth/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ action }) });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Supabase answers a good sign-in with tokens, then the app fetches the profile. */
function supabaseSignsIn(accessToken = fakeJwt(3600), refreshToken = "refresh-1") {
  fetchMock
    .mockResolvedValueOnce(json({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 }))
    .mockResolvedValueOnce(json(PROFILE));
  return { accessToken, refreshToken };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("stores both tokens in httpOnly cookies and never returns them in the body", async () => {
    const { accessToken, refreshToken } = supabaseSignsIn();

    const response = await call("login", { email: "a@b.co", password: "Passw0rd!" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ user: PROFILE });
    expect(JSON.stringify(body)).not.toContain(accessToken);

    const session = response.cookies.get("rw_session");
    expect(session?.value).toBe(accessToken);
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("lax");
    expect(session?.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);

    const refresh = response.cookies.get("rw_refresh");
    expect(refresh?.value).toBe(refreshToken);
    expect(refresh?.httpOnly).toBe(true);

    // The role cookie is a navigation hint the route guard reads, so it is not httpOnly.
    const role = response.cookies.get("rw_role");
    expect(role?.value).toBe("CITIZEN");
    expect(role?.httpOnly).toBe(false);
  });

  it("loads the profile straight from the database, not through the slower Edge Function", async () => {
    const { accessToken } = supabaseSignsIn();

    await call("login", { email: "a@b.co", password: "Passw0rd!" });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`https://project.supabase.co/rest/v1/profiles?select=*&id=eq.${TEST_USER_ID}`);
    expect(init.headers.Authorization).toBe(`Bearer ${accessToken}`);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/functions/v1/"))).toBe(false);
  });

  it("refuses a deactivated account and sets no cookies", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: fakeJwt(3600), refresh_token: "r" }))
      .mockResolvedValueOnce(json({ ...PROFILE, is_active: false }));

    const response = await call("login", { email: "a@b.co", password: "Passw0rd!" });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("account_deactivated");
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("rejects a request with no email or password without calling Supabase", async () => {
    const response = await call("login", { email: "a@b.co" });
    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays a wrong-password answer and sets no cookies", async () => {
    fetchMock.mockResolvedValueOnce(json({ msg: "Invalid login credentials", error_code: "invalid_credentials" }, 400));

    const response = await call("login", { email: "a@b.co", password: "wrong" });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Invalid login credentials");
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("explains an unconfirmed email in words the user can act on", async () => {
    fetchMock.mockResolvedValueOnce(json({ msg: "Email not confirmed", error_code: "email_not_confirmed" }, 400));

    const response = await call("login", { email: "a@b.co", password: "Passw0rd!" });
    const { error } = await response.json();

    expect(error.code).toBe("email_not_confirmed");
    expect(error.message).toContain("confirm your email");
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("reports an unreachable Supabase as 503", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const response = await call("login", { email: "a@b.co", password: "Passw0rd!" });
    expect(response.status).toBe(503);
  });

  it("does not sign the user in when their profile cannot be loaded", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: fakeJwt(3600), refresh_token: "r" }))
      .mockResolvedValueOnce(json({}, 500));

    const response = await call("login", { email: "a@b.co", password: "Passw0rd!" });

    expect(response.status).toBe(502);
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});

describe("register", () => {
  const form = { email: "a@b.co", password: "Passw0rd!", full_name: "Asha", phone: "+91 98765 43210" };

  it("rejects a weak password on the server, whatever the form allowed", async () => {
    for (const password of ["short1", "onlyletters", "12345678"]) {
      const response = await call("register", { ...form, password });
      expect(response.status).toBe(422);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs the user in straight away when confirmation is off", async () => {
    supabaseSignsIn();
    fetchMock.mockResolvedValueOnce(json(PROFILE)); // best-effort phone PATCH

    const response = await call("register", form);

    expect(response.status).toBe(201);
    expect(response.cookies.get("rw_session")).toBeDefined();
  });

  it("asks for confirmation, and signs nobody in, when the account still needs confirming", async () => {
    // With confirmation on, Supabase answers with the bare user and no session.
    fetchMock.mockResolvedValueOnce(json({ id: "u1", email: "a@b.co", confirmation_sent_at: "now" }));

    const response = await call("register", form);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.needs_confirmation).toBe(true);
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("sends the phone number and the confirmation landing page to Supabase", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "u1" }));

    await call("register", form);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/auth/v1/signup?redirect_to=");
    expect(decodeURIComponent(url.split("redirect_to=")[1])).toBe("http://localhost:3000/login?confirmed=1");
    expect(JSON.parse(init.body).data).toEqual({ full_name: "Asha", phone: "+91 98765 43210" });
  });

  it("gives the same answer for an address that is already registered", async () => {
    // Supabase hides duplicates when confirmation is on; the route must not undo that.
    fetchMock.mockResolvedValueOnce(json({ id: "existing", email: "a@b.co" }));
    const first = await (await call("register", form)).json();

    fetchMock.mockResolvedValueOnce(json({ id: "brand-new", email: "a@b.co" }));
    const second = await (await call("register", form)).json();

    expect(first).toEqual(second);
  });
});

describe("logout", () => {
  it("clears every session cookie", async () => {
    fetchMock.mockResolvedValue(json({}));

    const response = await call("logout", undefined, { rw_session: fakeJwt(3600), rw_refresh: "r", rw_role: "ADMIN" });

    expect(response.status).toBe(200);
    for (const name of ["rw_session", "rw_refresh", "rw_role"]) {
      expect(response.cookies.get(name)?.value).toBe("");
      expect(response.cookies.get(name)?.maxAge).toBe(0);
    }
  });

  it("still clears them when the user is already signed out", async () => {
    const response = await call("logout");
    expect(response.status).toBe(200);
    expect(response.cookies.get("rw_session")?.maxAge).toBe(0);
  });
});

describe("keepalive", () => {
  it("extends a healthy session without touching Supabase", async () => {
    const token = fakeJwt(3000);

    const response = await call("keepalive", undefined, { rw_session: token, rw_refresh: "r1", rw_role: "CITIZEN" });

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.cookies.get("rw_session")?.value).toBe(token);
    expect(response.cookies.get("rw_session")?.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(response.cookies.get("rw_refresh")?.value).toBe("r1");
    expect(response.cookies.get("rw_role")?.value).toBe("CITIZEN");
  });

  it("swaps in a new access token when the old one is close to expiry", async () => {
    const fresh = fakeJwt(3600);
    fetchMock.mockResolvedValueOnce(json({ access_token: fresh, refresh_token: "r2" }));

    const response = await call("keepalive", undefined, {
      rw_session: fakeJwt(10),
      rw_refresh: "r1",
      rw_role: "CITIZEN",
    });

    expect(response.status).toBe(200);
    expect(response.cookies.get("rw_session")?.value).toBe(fresh);
    expect(response.cookies.get("rw_refresh")?.value).toBe("r2");
  });

  it("answers 401 and clears the cookies when nobody is signed in", async () => {
    const response = await call("keepalive");
    expect(response.status).toBe(401);
    expect(response.cookies.get("rw_session")?.maxAge).toBe(0);
  });

  it("answers 401 when the refresh token has been revoked", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 400));

    const response = await call("keepalive", undefined, { rw_session: fakeJwt(-30), rw_refresh: "revoked" });

    expect(response.status).toBe(401);
    expect(response.cookies.get("rw_refresh")?.maxAge).toBe(0);
  });

  it("does not report the session as over when Supabase is briefly down", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const response = await call("keepalive", undefined, { rw_session: fakeJwt(-30), rw_refresh: "r1" });

    expect(response.status).not.toBe(401);
    expect(response.cookies.get("rw_session")?.maxAge).not.toBe(0);
  });
});

describe("unknown actions", () => {
  it("returns 404", async () => {
    const response = await call("nonsense", {});
    expect(response.status).toBe(404);
  });
});

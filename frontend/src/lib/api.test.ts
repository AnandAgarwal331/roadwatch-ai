import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, apiRequest, errorMessage } from "@/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiError", () => {
  it("pulls field messages out of a 422 body", () => {
    const error = new ApiError(422, "validation_error", "Some fields need attention.", {
      fields: [
        { field: "name", message: "String should have at least 2 characters" },
        { field: "max_concurrent_jobs", message: "Input should be less than or equal to 100" },
      ],
    });

    expect(error.fieldErrors).toEqual({
      name: "String should have at least 2 characters",
      max_concurrent_jobs: "Input should be less than or equal to 100",
    });
  });

  it("reports no field errors when the body carries none", () => {
    expect(new ApiError(500, "server_error", "Boom").fieldErrors).toEqual({});
    expect(new ApiError(400, "bad", "Bad", { fields: "not-an-array" }).fieldErrors).toEqual({});
  });

  it("classifies auth failures", () => {
    expect(new ApiError(401, "unauthorized", "x").isUnauthorized).toBe(true);
    expect(new ApiError(403, "forbidden", "x").isForbidden).toBe(true);
    expect(new ApiError(403, "forbidden", "x").isUnauthorized).toBe(false);
  });
});

describe("apiRequest", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes through the proxy rather than calling the backend directly", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get("/admin/dashboard");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/admin/dashboard");
  });

  it("drops empty query parameters and repeats array ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.get("/admin/reports", {
      page: 1,
      search: "",
      status: undefined,
      priority_level: null,
      damage_type: ["POTHOLE", "FLOODING"],
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("page=1");
    expect(url).not.toContain("search");
    expect(url).not.toContain("status");
    expect(url).not.toContain("priority_level");
    expect(url).toContain("damage_type=POTHOLE&damage_type=FLOODING");
  });

  it("lets the browser set the boundary for multipart bodies", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const form = new FormData();
    form.append("note", "done");
    await apiRequest("/team/tasks/1/complete", { method: "POST", body: form });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBe(form);
  });

  it("serialises JSON bodies and sets the content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.post("/admin/teams", { name: "North crew" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ name: "North crew" }));
  });

  it("turns an error body into an ApiError carrying the server's message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "conflict", message: "That code already exists." } }, 409),
    );

    await expect(api.post("/admin/teams", {})).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      message: "That code already exists.",
    });
  });

  it("falls back to a readable message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));

    await expect(api.get("/admin/dashboard")).rejects.toMatchObject({
      status: 502,
      message: "Request failed (502)",
    });
  });

  it("reports an unreachable server rather than leaking the fetch failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.get("/admin/dashboard")).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });

  it("returns undefined for a 204 instead of trying to parse a body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete("/whatever")).resolves.toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("prefers the server's message, then the error's, then a fallback", () => {
    expect(errorMessage(new ApiError(409, "conflict", "That code already exists."))).toBe(
      "That code already exists.",
    );
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("something odd")).toBe("Something went wrong. Please try again.");
  });
});

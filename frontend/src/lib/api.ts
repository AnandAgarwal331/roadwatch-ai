/**
 * Browser-side API client.
 *
 * Requests never go straight to FastAPI. They go to this app's own
 * `/api/proxy/*` route, which reads the httpOnly session cookie server-side and
 * attaches the bearer token. That keeps the token out of reach of any script
 * on the page, which `localStorage` would not.
 */

import type { ApiErrorBody } from "@/types";

export const PROXY_PREFIX = "/api/proxy";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages from a 422, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details?.fields;
    if (!Array.isArray(fields)) return {};
    return Object.fromEntries(
      fields
        .filter(
          (item): item is { field: string; message: string } =>
            typeof item === "object" && item !== null && "field" in item,
        )
        .map((item) => [item.field, item.message]),
    );
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

const NETWORK_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

async function toApiError(response: Response): Promise<ApiError> {
  let code = "http_error";
  let message = `Request failed (${response.status})`;
  let details: Record<string, unknown> | undefined;

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // A non-JSON error body (a gateway page, say) keeps the default message.
  }

  return new ApiError(response.status, code, message, details);
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Query parameters; `undefined`, `null` and `""` are dropped. */
  params?: Record<string, string | number | boolean | undefined | null | string[]>;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const url = `${PROXY_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  if (!params) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => search.append(key, String(item)));
    } else {
      search.append(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, params, headers, ...rest } = options;
  const isFormData = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      ...rest,
      headers: {
        // Let the browser set the multipart boundary itself.
        ...(isFormData || body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: isFormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", NETWORK_MESSAGE);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: RequestOptions["params"]) =>
    apiRequest<T>(path, { method: "GET", params }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

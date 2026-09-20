// Ported from backend/app/core/errors.py. Same JSON envelope:
//   {"error": {"code": "...", "message": "...", "details": {...}}}
// so the frontend's existing ApiError client-side type keeps working
// unchanged after cutover.

export class AppError extends Error {
  statusCode = 400;
  code = "bad_request";
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }

  toResponse(): Response {
    const body: Record<string, unknown> = { error: { code: this.code, message: this.message } };
    if (Object.keys(this.details).length > 0) {
      (body.error as Record<string, unknown>).details = this.details;
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this instanceof AuthenticationError) headers["WWW-Authenticate"] = "Bearer";
    return new Response(JSON.stringify(body), { status: this.statusCode, headers });
  }
}

export class NotFoundError extends AppError {
  override statusCode = 404;
  override code = "not_found";
}

export class ValidationError extends AppError {
  override statusCode = 422;
  override code = "validation_error";
}

export class AuthenticationError extends AppError {
  override statusCode = 401;
  override code = "unauthenticated";
}

export class PermissionDeniedError extends AppError {
  override statusCode = 403;
  override code = "forbidden";
}

export class ConflictError extends AppError {
  override statusCode = 409;
  override code = "conflict";
}

export class RateLimitError extends AppError {
  override statusCode = 429;
  override code = "rate_limited";
}

export class InvalidStatusTransitionError extends ConflictError {
  override code = "invalid_status_transition";
}

/** A provider (AI, traffic, storage) failed in a way the caller should know about. */
export class UpstreamServiceError extends AppError {
  override statusCode = 503;
  override code = "upstream_unavailable";
}

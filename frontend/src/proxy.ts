/**
 * Route protection.
 *
 * This is a **navigation** guard, not an authorisation boundary: it keeps
 * signed-out visitors off private pages and sends people to the right home
 * screen for their role. Real authorisation happens in Row Level Security
 * and the Edge Function on every request, so a forged role cookie buys
 * nothing but a page that fails to load its data.
 *
 * It is also where an expired access token is quietly swapped for a fresh one
 * (using the refresh cookie) before any page renders, so a signed-in user who
 * has been away for an hour is not bounced to the login screen.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  clearSessionCookies,
  REFRESH_COOKIE,
  resolveSession,
  ROLE_COOKIE,
  SESSION_COOKIE,
  setSessionCookies,
} from "@/lib/session";

const CITIZEN_ONLY = ["/report", "/my-reports", "/profile"];
const ADMIN_ONLY = ["/admin"];
const TEAM_ONLY = ["/team"];


function homeFor(role: string | undefined): string {
  if (role === "ADMIN") return "/admin";
  if (role === "REPAIR_TEAM") return "/team";
  return "/";
}

function redirectTo(request: NextRequest, pathname: string, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await resolveSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    request.cookies.get(REFRESH_COOKIE)?.value,
  );

  // The session as it stands after any renewal. `null` means signed out.
  const token = session.state === "none" || session.state === "expired" ? null : session.accessToken;
  const role = request.cookies.get(ROLE_COOKIE)?.value;
  // Cookies must be cleared when the session is over, and rewritten when it
  // was renewed; either way every response below has to carry the change.
  const finish = (response: NextResponse) => {
    if (session.state === "expired") clearSessionCookies(response);
    if (session.state === "renewed") {
      setSessionCookies(response, {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        role,
      });
    }
    return response;
  };

  const isProtected = [...CITIZEN_ONLY, ...ADMIN_ONLY, ...TEAM_ONLY].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !token) {
    // Preserve where they were heading so login can return them there.
    return finish(redirectTo(request, "/login", `?next=${encodeURIComponent(pathname + search)}`));
  }

  const wantsAdmin = ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (wantsAdmin && token && role !== "ADMIN") {
    return finish(redirectTo(request, homeFor(role)));
  }

  const wantsTeam = TEAM_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (wantsTeam && token && role !== "REPAIR_TEAM" && role !== "ADMIN") {
    return finish(redirectTo(request, homeFor(role)));
  }

  if (session.state === "renewed") {
    // The page about to render reads the session from this same request's
    // cookies, so they must be replaced here too or it would still see the
    // expired token and treat the user as signed out.
    request.cookies.set(SESSION_COOKIE, session.accessToken);
    request.cookies.set(REFRESH_COOKIE, session.refreshToken);
    return finish(NextResponse.next({ request }));
  }

  if (session.state === "expired") {
    // Drop the stale role cookie from this request as well, so a page rendering
    // right now does not think a role still applies.
    request.cookies.delete(SESSION_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    request.cookies.delete(ROLE_COOKIE);
    return finish(NextResponse.next({ request }));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, the API routes and static assets.
    "/((?!api|_next/static|_next/image|media|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

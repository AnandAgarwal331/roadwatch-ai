/**
 * Route protection.
 *
 * This is a **navigation** guard, not an authorisation boundary: it keeps
 * signed-out visitors off private pages and sends people to the right home
 * screen for their role. Real authorisation happens in Row Level Security
 * and the Edge Function on every request, so a forged role cookie buys
 * nothing but a page that fails to load its data.
 */

import { NextRequest, NextResponse } from "next/server";

import { ROLE_COOKIE, SESSION_COOKIE } from "@/lib/session";

const CITIZEN_ONLY = ["/report", "/my-reports", "/profile"];
const ADMIN_ONLY = ["/admin"];
const TEAM_ONLY = ["/team"];


function homeFor(role: string | undefined): string {
  if (role === "ADMIN") return "/admin";
  if (role === "REPAIR_TEAM") return "/team";
  return "/";
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const role = request.cookies.get(ROLE_COOKIE)?.value;

  const isProtected = [...CITIZEN_ONLY, ...ADMIN_ONLY, ...TEAM_ONLY].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were heading so login can return them there.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }


  const wantsAdmin = ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (wantsAdmin && token && role !== "ADMIN") {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  const wantsTeam = TEAM_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (wantsTeam && token && role !== "REPAIR_TEAM" && role !== "ADMIN") {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals, the API routes and static assets.
    "/((?!api|_next/static|_next/image|media|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

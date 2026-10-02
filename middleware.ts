import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { isAuthCookie, parseCookieHeader, parseSetCookies, serializeStamp, stampsFor, STAY_COOKIE, wantsToStay } from "@/lib/staySignedIn";

// Two jobs.
//
// 1. KEEP PEOPLE SIGNED IN (every page). The sign-in cookie is re-issued from
//    the server on each page load, with the lifetime the person chose on the
//    Log in or sign up panel — a year, renewed on every visit, or until the
//    browser closes. Without this the cookie was only ever written by script in
//    the page, and Safari caps those at seven days. See lib/staySignedIn.
//
// 2. GUARD THE DASHBOARD. Signed-out visitors are sent home instead of being
//    shown a host dashboard. createMiddlewareClient, not the server-component
//    client, because an access token older than an hour is refreshed on read
//    and only this client can put the refreshed cookie on the response. The
//    matcher covers the subpages too. /addhome is deliberately not guarded: it
//    handles a signed-out visitor itself, with the log in box on the page.

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const hasAuthCookie = request.cookies.getAll().some((c) => isAuthCookie(c.name));

  // Nobody signed in: nothing to keep alive, and no reason to ask Supabase.
  if (!hasAuthCookie) {
    if (isDashboard) {
      return NextResponse.redirect(new URL("/?error=Please log in first to see your dashboard.", request.url));
    }
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res: response });

  if (isDashboard) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return NextResponse.redirect(new URL("/?error=Please log in first to see your dashboard.", request.url));
    }
  } else {
    // Reads the cookie; only goes to Supabase when the access token has expired
    // and needs refreshing, which writes the new one onto the response.
    const { data } = await supabase.auth.getSession();
    // A dead session (refresh token revoked, account deactivated) is left for
    // the page to discover, exactly as before — nothing to re-stamp.
    if (!data.session) return response;
  }

  const stay = wantsToStay(request.cookies.get(STAY_COOKIE)?.value);
  const stamps = stampsFor(
    parseCookieHeader(request.headers.get("cookie")),
    parseSetCookies(response.headers.get("set-cookie")),
    stay,
    request.nextUrl.protocol === "https:"
  );
  for (const s of stamps) response.headers.append("set-cookie", serializeStamp(s));

  // Returned rather than NextResponse.next() so the refreshed and re-stamped
  // cookies actually reach the browser.
  return response;
}

export const config = {
  // Every page, plus the one endpoint the browser calls after it refreshes the
  // token in an open tab (/api/auth/keep). Not the rest of /api, not Next's
  // own files, not anything with a file extension (images, icons, robots).
  matcher: ["/((?!_next/|api/|.*\\..*).*)", "/api/auth/keep"],
};

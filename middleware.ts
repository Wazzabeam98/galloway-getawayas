import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import {
  isAuthCookie,
  lostSignInToReport,
  LEGACY_STAY_COOKIE,
  parseCookieHeader,
  parseSeen,
  parseSetCookies,
  resolveStayChoice,
  SEEN_COOKIE,
  seenValue,
  serializeCookie,
  serializeStamp,
  sessionIdFromAuthCookie,
  stampsFor,
  STAY_COOKIE,
  STAY_MAX_AGE_SECONDS,
  type LostSignIn,
} from "@/lib/staySignedIn";

// Three jobs.
//
// 1. KEEP PEOPLE SIGNED IN (every page). The sign-in cookie is re-issued from
//    the server on each page load, with the lifetime the person chose on the
//    Log in or sign up panel — a year, renewed on every visit, or until the
//    browser closes. Without this the cookie was only ever written by script in
//    the page, and Safari caps those at seven days. The "don't stay" choice
//    counts only for the session it was made for: a pending one is bound here
//    to the new session, and one left by an earlier session is deleted. See
//    lib/staySignedIn.
//
// 2. NOTICE A LOST SIGN-IN. gg_seen marks a device that had a live sign-in. A
//    page load that still carries it, but whose sign-in cookie is gone or no
//    longer honoured, is a sign-in the person did not end: it is reported to
//    /api/auth/lost (the error log, so the morning digest shows it) with how
//    long since the device was last seen signed in.
//
// 3. GUARD THE DASHBOARD. Signed-out visitors are sent home instead of being
//    shown a host dashboard. createMiddlewareClient, not the server-component
//    client, because an access token older than an hour is refreshed on read
//    and only this client can put the refreshed cookie on the response. The
//    matcher covers the subpages too. /addhome is deliberately not guarded: it
//    handles a signed-out visitor itself, with the log in box on the page.

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const secure = request.nextUrl.protocol === "https:";
  const sent = parseCookieHeader(request.headers.get("cookie"));
  const authCookies = sent.filter((c) => isAuthCookie(c.name));
  const hasAuthCookie = authCookies.length > 0;
  const seen = parseSeen(request.cookies.get(SEEN_COOKIE)?.value);
  const hasLegacyStay = request.cookies.has(LEGACY_STAY_COOKIE);
  // A real page load: not Next's router fetches or prefetches (RSC,
  // Next-Router-Prefetch), not the browser's own speculative prefetches
  // (Sec-Purpose / Purpose), and, where the browser says, a document.
  const h = request.headers;
  const dest = h.get("sec-fetch-dest");
  const isDocument =
    request.method === "GET" &&
    !h.get("rsc") &&
    !h.get("next-router-prefetch") &&
    !h.get("sec-purpose") &&
    !h.get("purpose") &&
    (!dest || dest === "document");

  // Nobody signed in: nothing to keep alive, and no reason to ask Supabase.
  if (!hasAuthCookie) {
    const response = isDashboard
      ? NextResponse.redirect(new URL("/?error=Please log in first to see your dashboard.", request.url))
      : NextResponse.next();
    const lost = lostSignInToReport({ seen, hasAuthCookie, sessionOk: false, isDocument });
    if (lost) report(event, request, lost, seen!);
    if (seen && isDocument) response.headers.append("set-cookie", serializeCookie(SEEN_COOKIE, "", { maxAge: 0, secure }));
    if (hasLegacyStay) response.headers.append("set-cookie", serializeCookie(LEGACY_STAY_COOKIE, "", { maxAge: 0, secure }));
    return response;
  }

  const response = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res: response });

  let sessionOk: boolean;
  let refusal: string | null = null;
  if (isDashboard) {
    const { data, error } = await supabase.auth.getUser();
    sessionOk = !!data.user;
    if (error) refusal = error.message;
  } else {
    // Reads the cookie; only goes to Supabase when the access token has expired
    // and needs refreshing, which writes the new one onto the response.
    const { data, error } = await supabase.auth.getSession();
    sessionOk = !!data.session;
    if (error) refusal = error.message;
  }

  if (!sessionOk) {
    // A dead session (refresh token revoked, account deactivated) is left for
    // the page to discover — but if this device did not end it, it is told.
    const lost = lostSignInToReport({ seen, hasAuthCookie, sessionOk, isDocument });
    if (lost) report(event, request, lost, seen!, refusal);
    const out = isDashboard
      ? NextResponse.redirect(new URL("/?error=Please log in first to see your dashboard.", request.url))
      : response;
    if (seen && isDocument) out.headers.append("set-cookie", serializeCookie(SEEN_COOKIE, "", { maxAge: 0, secure }));
    return out;
  }

  // The session id is the same before and after a refresh, so the cookie the
  // browser sent is enough to know which session this is.
  const sessionId = sessionIdFromAuthCookie(authCookies.find((c) => !/\.\d+$/.test(c.name))?.value ?? null);
  const choice = resolveStayChoice(request.cookies.get(STAY_COOKIE)?.value, sessionId);

  const stamps = stampsFor(sent, parseSetCookies(response.headers.get("set-cookie")), choice.stay, secure);
  for (const s of stamps) response.headers.append("set-cookie", serializeStamp(s));

  // The choice cookie lives exactly as long as a don't-stay sign-in: until the
  // browser closes.
  if (choice.rewrite === "delete") response.headers.append("set-cookie", serializeCookie(STAY_COOKIE, "", { maxAge: 0, secure }));
  else if (choice.rewrite) response.headers.append("set-cookie", serializeCookie(STAY_COOKIE, choice.rewrite.value, { secure }));
  if (hasLegacyStay) response.headers.append("set-cookie", serializeCookie(LEGACY_STAY_COOKIE, "", { maxAge: 0, secure }));

  // Seen signed in, now — with the same lifetime as the sign-in cookie, so a
  // browser-session sign-in that ends with the browser is not reported as lost.
  if (sessionId) {
    response.headers.append(
      "set-cookie",
      serializeCookie(SEEN_COOKIE, seenValue(sessionId, Date.now() / 1000), { maxAge: choice.stay ? STAY_MAX_AGE_SECONDS : undefined, secure })
    );
  }

  // Returned rather than NextResponse.next() so the refreshed and re-stamped
  // cookies actually reach the browser.
  return response;
}

// Fire and forget: the page is not held up while the loss is written down.
function report(event: NextFetchEvent, request: NextRequest, kind: LostSignIn, seen: { sessionId: string; at: number }, refusal?: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const body = JSON.stringify({
    kind,
    session: seen.sessionId.slice(0, 8),
    lastSeenAt: new Date(seen.at * 1000).toISOString(),
    minutesSinceSeen: Math.round((Date.now() / 1000 - seen.at) / 60),
    path: request.nextUrl.pathname,
    userAgent: (request.headers.get("user-agent") || "").slice(0, 200),
    refusal: refusal ? refusal.slice(0, 200) : null,
  });
  event.waitUntil(
    fetch(new URL("/api/auth/lost", request.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-gg-internal": secret },
      body,
    }).catch(() => {})
  );
}

export const config = {
  // Every page, plus the one endpoint the browser calls after it refreshes the
  // token in an open tab (/api/auth/keep). Not the rest of /api, not Next's
  // own files, not anything with a file extension (images, icons, robots).
  matcher: ["/((?!_next/|api/|.*\\..*).*)", "/api/auth/keep"],
};

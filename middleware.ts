import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

// Signed-out visitors are sent home instead of being shown a host dashboard.
//
// This never ran until now: the matcher said "/add-home" and "/dash-board",
// and the routes are /addhome and /dashboard, so it matched nothing.
//
// Two things had to change before switching it on could be safe.
//
// The client is createMiddlewareClient, not createServerComponentClient. The
// server-component one can read cookies but cannot write them, and an access
// token older than an hour is refreshed on read — so a genuinely signed-in
// person whose token had just expired would have been bounced with no way to
// stay signed in. This one puts the refreshed cookies on the response.
//
// The matcher covers the subpages. "/dashboard" on its own would have left
// /dashboard/bookings, /dashboard/earnings and the rest unprotected, which is
// the half that has anything worth protecting on it.
//
// /addhome is deliberately NOT here. It already handles a signed-out visitor
// properly, with "Sign in to become a host" and the log in box on the page —
// better than being thrown to the home page, and it is where the navbar sends
// everyone who has not signed up yet.

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createMiddlewareClient({ req: request, res: response });

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.redirect(
      new URL("/?error=Please log in first to see your dashboard.", request.url)
    );
  }

  // Returned rather than NextResponse.next() so any refreshed auth cookie the
  // client just wrote actually reaches the browser.
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};

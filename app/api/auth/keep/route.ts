import { NextResponse } from 'next/server';

// Does nothing itself. The middleware runs on this path and re-issues the
// sign-in cookie from the server (lib/staySignedIn); the browser calls it right
// after refreshing its token in a long-open tab, so the cookie the page script
// just wrote — which Safari would cap at seven days — is replaced at once by
// the server's long-lived one.
export const dynamic = 'force-dynamic';

export function POST() {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

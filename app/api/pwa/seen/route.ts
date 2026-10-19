// Remembers that this device has seen the "Add to Home Screen" hint, in a
// cookie set by the SERVER. Safari deletes anything a page writes for itself
// (localStorage, cookies set by script) after seven days without a visit, which
// is how the hint kept coming back; a cookie the server sets lives its full
// year. Readable by the page (not HttpOnly) — it holds nothing but "seen".

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HINT_COOKIE = 'gg_a2hs_seen';

export async function POST(request: Request) {
    const res = NextResponse.json({ ok: true });
    const secure = new URL(request.url).protocol === 'https:';
    res.headers.append('set-cookie',
        HINT_COOKIE + '=1; Path=/; Max-Age=31536000; SameSite=Lax' + (secure ? '; Secure' : ''));
    return res;
}

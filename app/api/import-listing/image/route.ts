import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { checkImportImageUrl } from '@/lib/urlGuard';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// THIS ROUTE DID NOT EXIST, AND THE CLIENT HAS BEEN CALLING IT ALL ALONG.
//
// app/addhome/page.tsx imports a listing, gets an og:image back, and fetches
// `/api/import-listing/image?url=…` to turn it into a File it can upload.
// There was no such route, so every one of those calls 404'd. The client
// checks `if (imgRes.ok)` and otherwise says nothing, so the cover photo
// simply never arrived and the import looked like it had worked — the failure
// nobody reports, because an empty photo slot looks like an empty photo slot.
//
// WHY A PROXY AT ALL. The browser cannot turn a cross-origin image into a File
// without CORS headers the CDN does not send, so the bytes have to come
// through us.
//
// WHICH MAKES IT THE SAME KIND OF HOLE AS THE PAGE FETCH. A route that
// fetches a caller-supplied URL server-side is a server-side request forgery
// unless something stops it, so this goes through lib/urlGuard exactly as
// /api/import-listing does — against the CDN allowlist, because an og:image
// on an Airbnb page points at their image host rather than at airbnb.com.
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
    try {
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so anyone who writes their
        // own cookie passes it.
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
        }

        const url = new URL(req.url).searchParams.get('url') || '';
        if (!url) {
            return NextResponse.json({ error: 'No image was named.' }, { status: 400 });
        }

        const verdict = await checkImportImageUrl(url);
        if (!verdict.ok) {
            // Reported, not swallowed. If a listing site changes its image
            // host, every import quietly loses its cover photo again and the
            // only way anybody finds out is this line.
            await logError(
                '[import-listing/image] refused an image host',
                { url: url.slice(0, 300), reason: verdict.reason },
                { path: 'import-listing/image', userId: user.id }
            );
            return NextResponse.json({ error: verdict.reason }, { status: 400 });
        }

        // No redirect following. An image CDN answering a redirect is not
        // something these two sites do, and following one would need the same
        // per-hop re-check the page route does. Refusing is the smaller thing
        // to get right.
        const upstream = await fetch(url, {
            redirect: 'manual',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*',
            },
            signal: AbortSignal.timeout(10000),
        });

        if (!upstream.ok) {
            return NextResponse.json(
                { error: `That photo could not be fetched (status ${upstream.status}).` },
                { status: 502 }
            );
        }

        // It has to actually be an image. Without this the route will proxy
        // whatever the CDN hands back, including an HTML error page, and the
        // wizard would attach it as "imported-cover.jpg".
        const type = (upstream.headers.get('content-type') || '').toLowerCase();
        if (!type.startsWith('image/')) {
            return NextResponse.json(
                { error: 'That link is not an image.' },
                { status: 415 }
            );
        }

        // Declared length first, so an oversized file is refused before it is
        // pulled down rather than after.
        const declared = Number(upstream.headers.get('content-length') || 0);
        if (declared > MAX_BYTES) {
            return NextResponse.json({ error: 'That photo is too large.' }, { status: 413 });
        }

        const buffer = await upstream.arrayBuffer();
        if (buffer.byteLength > MAX_BYTES) {
            // A missing or lying content-length is why this is checked twice.
            return NextResponse.json({ error: 'That photo is too large.' }, { status: 413 });
        }

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': type,
                'Content-Length': String(buffer.byteLength),
                // The wizard turns this into a File immediately; nothing
                // downstream benefits from it being cached, and it is somebody
                // else's photo.
                'Cache-Control': 'no-store',
            },
        });
    } catch (err: any) {
        const timedOut = err && err.name === 'TimeoutError';
        await logError(
            '[import-listing/image] could not fetch the cover photo',
            err,
            { path: 'import-listing/image' }
        );
        return NextResponse.json(
            { error: timedOut ? 'That photo took too long to fetch.' : 'That photo could not be fetched.' },
            { status: timedOut ? 504 : 500 }
        );
    }
}

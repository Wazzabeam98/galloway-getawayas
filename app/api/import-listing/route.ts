import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { checkImportUrl } from '@/lib/urlGuard';
import { logError } from '@/lib/logError';

// Pulls out the content of a <meta property="..."> or <meta name="..."> tag,
// trying both attribute orders since sites vary.
function extractMeta(html: string, key: string): string | null {
    const patterns = [
        new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
        new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, 'i'),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return decodeHtmlEntities(match[1]);
    }
    return null;
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

export async function POST(req: NextRequest) {
    try {
        // Signed in only. This fetches a page from our server on the caller's
        // behalf, and an open endpoint that does that can be used to make
        // requests look like they came from us.
        //
        // getUser(), not getSession(). getSession() only decodes the cookie —
        // it never checks the signature — so anyone who writes their own
        // cookie passes it. On this route that is the difference between
        // "a host can make us fetch things" and "anyone can".
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
        }

        const { url } = await req.json();

        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'Please provide a listing URL.' }, { status: 400 });
        }

        // https, an allowed domain, and a public address — see lib/urlGuard.
        // The check that used to be here was `hostname.includes('airbnb.')`,
        // which airbnb.evil.com satisfies.
        const verdict = await checkImportUrl(url);
        if (!verdict.ok) {
            return NextResponse.json({ error: verdict.reason }, { status: 400 });
        }

        // REDIRECTS ARE CHECKED TOO, AND THIS IS NOT OPTIONAL.
        //
        // fetch() follows redirects by default, and it does not re-run
        // anything above. A page on a genuinely allowed domain answering
        // "302 → http://169.254.169.254/" would have been followed straight
        // past the allowlist, which makes the allowlist decorative. So the
        // hops are walked by hand and every one goes through the same check.
        //
        // Three hops is enough for the www/locale redirects these two sites
        // actually use, and short enough that a redirect loop ends quickly.
        let current = url;
        let response: Response | null = null;

        for (let hop = 0; hop < 4; hop++) {
            response = await fetch(current, {
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                    'Accept-Language': 'en-GB,en;q=0.9',
                },
                // Give up after 10s so a blocked/slow site doesn't hang the button.
                signal: AbortSignal.timeout(10000),
            });

            if (response.status < 300 || response.status > 399) break;

            const location = response.headers.get('location');
            if (!location) break;

            // Resolved against the current URL, because a Location header is
            // allowed to be relative.
            const next = new URL(location, current).toString();
            const hopVerdict = await checkImportUrl(next);
            if (!hopVerdict.ok) {
                await logError(
                    '[import-listing] a redirect tried to leave the allowed hosts',
                    { from: current, to: next, reason: hopVerdict.reason },
                    { path: 'import-listing', userId: user.id }
                );
                return NextResponse.json(
                    { error: 'That link redirects somewhere we will not follow.' },
                    { status: 400 }
                );
            }
            current = next;
        }

        if (!response) {
            return NextResponse.json({ error: 'Something went wrong fetching that link.' }, { status: 502 });
        }

        if (response.status >= 300 && response.status <= 399) {
            return NextResponse.json(
                { error: 'That link redirects too many times.' },
                { status: 502 }
            );
        }

        const target = new URL(current);

        if (!response.ok) {
            return NextResponse.json(
                { error: `The site returned an error (status ${response.status}). It may be blocking automated requests.` },
                { status: 502 }
            );
        }

        const html = await response.text();

        const title = extractMeta(html, 'og:title');
        const description = extractMeta(html, 'og:description');
        const image = extractMeta(html, 'og:image');

        if (!title && !description && !image) {
            return NextResponse.json(
                { error: 'Couldn\'t find any usable details on that page — this site may be blocking automated access.' },
                { status: 502 }
            );
        }

        return NextResponse.json({ title, description, image, source: target.hostname });
    } catch (err: any) {
        const message = err?.name === 'TimeoutError'
            ? 'The site took too long to respond.'
            : 'Something went wrong fetching that link.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

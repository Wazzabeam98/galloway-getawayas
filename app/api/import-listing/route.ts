import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

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
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
        }

        const { url } = await req.json();

        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'Please provide a listing URL.' }, { status: 400 });
        }

        let target: URL;
        try {
            target = new URL(url);
        } catch {
            return NextResponse.json({ error: 'That doesn\'t look like a valid URL.' }, { status: 400 });
        }

        // Only these two, and only over https — enough on its own to keep this
        // away from internal addresses.
        if (target.protocol !== 'https:') {
            return NextResponse.json({ error: 'That link needs to start with https.' }, { status: 400 });
        }

        const allowedHosts = ['airbnb.', 'booking.com'];
        const isAllowed = allowedHosts.some((h) => target.hostname.includes(h));
        if (!isAllowed) {
            return NextResponse.json({ error: 'Please use an Airbnb or Booking.com listing link.' }, { status: 400 });
        }

        const response = await fetch(target.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept-Language': 'en-GB,en;q=0.9',
            },
            // Give up after 10s so a blocked/slow site doesn't hang the button.
            signal: AbortSignal.timeout(10000),
        });

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

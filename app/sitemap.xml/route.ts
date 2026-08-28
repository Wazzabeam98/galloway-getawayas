import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Env from '@/config/Env';
import { logError } from '@/lib/logError';

const SITE_URL = 'https://gallowaygetaways.co.uk';

// A ROUTE HANDLER, NOT app/sitemap.ts. THIS IS THE WHOLE POINT OF THE FILE.
//
// This used to be app/sitemap.ts with `export const dynamic = 'force-dynamic'`
// at the top and a comment saying it was therefore generated per request. It
// was not. Next 13.5 prerenders the metadata sitemap file at BUILD time and
// ignores the segment config while doing it — `next build` lists it as
// "○ (Static)" and writes a finished .next/server/app/sitemap.xml.body to
// disk. Adding `revalidate = 0` as well changes nothing; it was tried.
//
// So the sitemap only ever changed when somebody deployed. A property
// published on a Tuesday was invisible to Google until the next unrelated
// deploy happened to rebuild it — which, on a site that goes weeks between
// deploys, is the difference between a new listing ranking this month and
// next. Nothing looked broken: the file was there, it was valid, it was
// simply old.
//
// Route handlers DO honour force-dynamic, so this runs on every request.
// If this ever moves back to app/sitemap.ts, check `next build` for a
// "λ /sitemap.xml" and not a "○".
export const dynamic = 'force-dynamic';

interface Entry {
    loc: string;
    lastmod: string;
    changefreq: string;
    priority: string;
}

function xmlEscape(value: string): string {
    return value
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&apos;');
}

function render(entries: Entry[]): string {
    const body = entries
        .map(
            (e) =>
                '<url>'
                + '<loc>' + xmlEscape(e.loc) + '</loc>'
                + '<lastmod>' + e.lastmod + '</lastmod>'
                + '<changefreq>' + e.changefreq + '</changefreq>'
                + '<priority>' + e.priority + '</priority>'
                + '</url>'
        )
        .join('\n');

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + body
        + '\n</urlset>\n'
    );
}

export async function GET() {
    const now = new Date().toISOString();

    // The trailing slash matters: the canonical the root layout emits for the
    // home page is metadataBase + '/', so naming it without one here would
    // put two spellings of the same page in front of Google.
    const staticPages: Entry[] = [
        { loc: `${SITE_URL}/`, lastmod: now, changefreq: 'daily', priority: '1.0' },
        { loc: `${SITE_URL}/services`, lastmod: now, changefreq: 'weekly', priority: '0.5' },
        { loc: `${SITE_URL}/business`, lastmod: now, changefreq: 'monthly', priority: '0.4' },
        { loc: `${SITE_URL}/contact`, lastmod: now, changefreq: 'yearly', priority: '0.4' },
        { loc: `${SITE_URL}/terms`, lastmod: now, changefreq: 'yearly', priority: '0.3' },
        { loc: `${SITE_URL}/privacy`, lastmod: now, changefreq: 'yearly', priority: '0.3' },
        { loc: `${SITE_URL}/cancellation-policy`, lastmod: now, changefreq: 'yearly', priority: '0.4' },
    ];

    const headers = {
        'Content-Type': 'application/xml; charset=utf-8',
        // Five minutes at the CDN, so a crawl storm does not become a query
        // storm, but a listing published now is in the sitemap within minutes
        // rather than at the next deploy.
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    };

    try {
        const supabase = createClient(Env.SUPABASE_URL, Env.SUPABASE_KEY);

        // Only published listings. app/homes/[id] says noindex for anything
        // that is not published, so the two agree about what is public.
        const { data: listings, error } = await supabase
            .from('listings')
            .select('id, created_at, approved_at, status')
            .eq('status', 'published');

        // supabase-js does NOT throw on a failed query — it hands the error
        // back in the result. Without this the catch below never fires,
        // `listings` is null, and a sitemap with every property missing from
        // it goes out looking perfectly valid. Google reads that as "those
        // pages are gone".
        if (error) {
            await logError(
                '[sitemap] could not read listings — the sitemap went out without them',
                error,
                { path: 'sitemap.xml' }
            );
            return new NextResponse(render(staticPages), { headers });
        }

        const listingPages: Entry[] = (listings || []).map((listing: any) => ({
            loc: `${SITE_URL}/homes/${listing.id}`,
            // approved_at is the closest thing the listings table has to
            // "when did this last change" — there is no updated_at column.
            // Worth adding one: without it an edited listing keeps telling
            // Google it has not moved since the day it was first approved.
            lastmod: new Date(listing.approved_at || listing.created_at || now).toISOString(),
            changefreq: 'weekly',
            priority: '0.8',
        }));

        // Deliberately NOT reporting an empty list. "No listings yet" is a
        // true state before launch, and this route runs once per crawler hit,
        // so reporting it would fill /admin/errors with the same row. A query
        // that FAILED is a different thing and is caught above.
        return new NextResponse(render(staticPages.concat(listingPages)), { headers });
    } catch (err) {
        // A sitemap that fails shouldn't take the site down. But it must not
        // fail quietly either: this now shows up on /admin/errors rather than
        // only in a Vercel log nobody reads.
        await logError('[sitemap] could not be built', err, { path: 'sitemap.xml' });
        return new NextResponse(render(staticPages), { headers });
    }
}

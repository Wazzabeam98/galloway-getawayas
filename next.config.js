/** @type {import('next').NextConfig} */

// The GitHub `test-and-build` check runs `next build` with no Supabase env. Some
// client components construct createClientComponentClient() during static
// prerendering, and @supabase/auth-helpers-nextjs THROWS at construction when the
// public env vars are absent — which fails the build. next.config.js runs before
// the build, so default the two PUBLIC vars to the same placeholders config/Env.ts
// already uses for the anon client when they are missing. `||=` keeps the real
// values on Vercel and in local dev; it only fills in the compile gate (whose
// build artifact is thrown away) so it never needs live secrets. The secret
// service-role key is deliberately NOT defaulted — nothing should prerender a
// service-role read (those paths fail soft, see lib/revalidatePublic and the
// grid loaders).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'placeholder';

// Listing photos live in Supabase Storage, and getImageUrl() builds their URLs
// from NEXT_PUBLIC_SUPABASE_URL — so the host next/image is allowed to load
// from changes with the environment, and every environment needs listing here.
//
//   auth.gallowaygetaways.co.uk    production, via the Supabase custom domain
//   yefoqcabuijcowoqewtc...        preview and local, which use the dev project
//   hviwjxigqivjfhmhpjiy...        production's old host, kept so that reverting
//                                  the env var is enough to roll back
//
// The entry that used to be here, uujmaobsbhxwzjvbwdwb.supabase.co, belongs to
// no project of ours — images through next/image have been failing wherever
// they are used, HomeCard included.
// Where each old /services/<trade> page now lives — the same answer
// tradeListHref() in lib/serviceProviders.ts gives, written out because this
// file cannot import TypeScript. tests/old-services-routes.test.ts fails if
// the two disagree or a trade is added to TRADES without a line here.
//   guest      not a host trade — experiences are booked against a stay
//   sponge     coming soon, nobody to show — the unfiltered list
//   the rest   the list, filtered to that trade
const OLD_TRADE_PAGES = {
    guest: '/',
    sponge: '/services',
    bin: '/services?trade=bin',
    trees: '/services?trade=trees',
    droplet: '/services?trade=droplet',
    electrician: '/services?trade=electrician',
    joiner: '/services?trade=joiner',
    plumber: '/services?trade=plumber',
    roofer: '/services?trade=roofer',
    painter: '/services?trade=painter',
    handyman: '/services?trade=handyman',
    other: '/services?trade=other',
}

const nextConfig = {
    // No "X-Powered-By: Next.js" on every response — it tells a scanner which
    // framework (and so which known holes) to try, and tells a visitor nothing.
    poweredByHeader: false,

    // Where the build writes. Default `.next` for dev, `next start` and Vercel,
    // but overridable so a compile-only gate (the pre-push hook) can build into
    // a throwaway dir instead of clobbering the `.next` a running `next dev` is
    // serving from — which stamps the dev server with a build id its on-disk
    // chunks no longer match, 404ing them until it is restarted. Build or dev
    // used to mean "not both"; a separate distDir lets them coexist.
    distDir: process.env.NEXT_DIST_DIR || '.next',
    images: {
        domains: [
            'auth.gallowaygetaways.co.uk',
            'yefoqcabuijcowoqewtc.supabase.co',
            'hviwjxigqivjfhmhpjiy.supabase.co',
        ],
        // Serve AVIF where the browser takes it, WebP otherwise. AVIF is ~20–30%
        // smaller than WebP for these cottage photos, so the hero and the grid
        // cards arrive in fewer bytes. Next falls back to WebP, then the original
        // JPEG, so nothing breaks on an older browser.
        formats: ['image/avif', 'image/webp'],
        // Keep an optimised image at the edge for 31 days once built, rather than
        // the 60s default — the source photos rarely change, so re-optimising on
        // every miss was wasted work and a slow first byte for the image.
        minimumCacheTTL: 60 * 60 * 24 * 31,
    },

    // /homes has never been a route. Only /homes/[id] exists, so the bare
    // path answered 404 — and /services/guest used to send signed-out
    // visitors straight to it. That internal link is fixed at its source, so
    // this is for the addresses already loose in the world: a pasted link, a
    // bookmark, anything a crawler picked up while it was 404ing.
    //
    // Permanent (308), because the answer will not change: the cottages are
    // on the home page and /homes is not coming back. A 308 keeps the method
    // and tells Google to forget the old address rather than re-checking it.
    //
    // The source matches /homes EXACTLY. It does not touch /homes/<id>.
    async redirects() {
        return [
            {
                source: '/homes',
                destination: '/',
                permanent: true,
            },

            // /experiences has never been a page — the marketplace is at
            // /experiences/browse and /experiences/<bookingId> is a guest's own
            // booking — so the bare path 404'd, and it is the address people
            // type, the one Search Console listed as "Not found (404)" (Oct
            // 2026), and the one a printed beer-mat QR code nearly pointed at.
            // An explicit 301 rather than `permanent` (308) because 301 is what
            // was asked for; Google treats the two alike. Exact source, so
            // /experiences/<anything> is untouched, and any ?utm_ query is
            // carried across.
            {
                source: '/experiences',
                destination: '/experiences/browse',
                statusCode: 301,
            },

            // THE OLD SERVICES PAGES. /services/property (the trade-tile grid)
            // and /services/<trade> (one shop page per trade) were real,
            // indexable pages; they are now the one list at /services, with
            // trade as a filter. Permanent for the same reason as /homes —
            // redirect() in a page answers 307 on Next 13.5, which tells Google
            // to keep the old address and check back.
            //
            // Each source is EXACT: /services/joiner/<providerId>, the public
            // profile, is untouched. Next carries any incoming query string
            // across (?ask=… survives).
            {
                source: '/services/property',
                destination: '/services',
                permanent: true,
            },
            ...Object.keys(OLD_TRADE_PAGES).map((trade) => ({
                source: '/services/' + trade,
                destination: OLD_TRADE_PAGES[trade],
                permanent: true,
            })),
        ];
    },
}

module.exports = nextConfig

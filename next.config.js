/** @type {import('next').NextConfig} */

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
const nextConfig = {
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
    },
}

module.exports = nextConfig

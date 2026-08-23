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
    images: {
        domains: [
            'auth.gallowaygetaways.co.uk',
            'yefoqcabuijcowoqewtc.supabase.co',
            'hviwjxigqivjfhmhpjiy.supabase.co',
        ],
    },
}

module.exports = nextConfig

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// What this deployment actually is, asked of the deployment itself.
//
// WHY IT EXISTS: the e2e suite creates auth accounts and lodges applications.
// Pointed at production it would put invented tradesmen in the real queue and
// real rows in the real database, and the only thing standing between those two
// outcomes was a URL in a config file. A URL is a poor guard — it went stale
// once already, silently, when the branch it named was merged.
//
// So the suite asks before it types. Every other way of answering is worse:
//
//   The Vercel API tells you what is CONFIGURED, not what the process is
//   running with. This project has already shipped an env-var scoping mistake
//   (RESEND_API_KEY on Production but not Preview) where the configuration
//   looked right and the running code disagreed.
//
//   Reading NEXT_PUBLIC_SUPABASE_URL out of the client bundle works until a
//   chunk is split differently, and then it fails open — the worst direction
//   for a safety check to fail in.
//
// This reads process.env in the running process, which is the thing that
// actually decides which database gets written to.
//
// WHAT IT DISCLOSES: on production, only that it is production. That is all a
// guard needs in order to refuse, and it is already obvious from the domain.
// The commit, the branch and the database are returned on preview and
// development only — where they are needed and where nothing is at stake.
export async function GET() {
    const env = process.env.VERCEL_ENV || 'development';

    if (env === 'production') {
        return NextResponse.json(
            { env },
            { headers: { 'cache-control': 'no-store' } }
        );
    }

    // Just the project ref, not the URL and never a key. The ref is what
    // identifies WHICH database, which is the only part a guard has to check.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const match = url.match(/https?:\/\/([a-z0-9]+)\.supabase\./i);

    return NextResponse.json(
        {
            env,
            commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
            branch: process.env.VERCEL_GIT_COMMIT_REF || null,
            supabase: match ? match[1] : null,
        },
        { headers: { 'cache-control': 'no-store' } }
    );
}

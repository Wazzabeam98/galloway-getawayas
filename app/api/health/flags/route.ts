import { NextResponse } from 'next/server';
import { businessSignupsOpen } from '@/lib/serviceOrders';

export const dynamic = 'force-dynamic';

// How this deployment reads its launch switches — never their values.
//
// BUSINESS_SIGNUPS_OPEN is a Sensitive variable, so neither the Vercel
// dashboard nor the CLI will show it back. When it was set on Production and
// the tiles stayed shut, there was no way to tell a missing variable from a
// mistyped one. This answers that from the running process: is it set at all,
// and does it read as open. Both are already public — the /business tiles show
// the second — so nothing is disclosed that a visitor cannot see.
export async function GET() {
    const raw = process.env.BUSINESS_SIGNUPS_OPEN;
    return NextResponse.json(
        {
            env: process.env.VERCEL_ENV || 'development',
            businessSignups: {
                set: typeof raw === 'string' && raw.length > 0,
                open: businessSignupsOpen(),
            },
        },
        { headers: { 'cache-control': 'no-store' } }
    );
}

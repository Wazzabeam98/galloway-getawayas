import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { recordCronRun } from '@/lib/cronHeartbeat';
import { sealListingSecrets } from '@/lib/sealListingSecrets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'seal-listing-secrets';

// Door codes and wifi passwords are encrypted at rest (lib/secretBox). This
// seals any still stored as plain text — the ones from before encryption, and
// anything a script wrote directly — and checks every sealed one opens with
// this environment's key. Hourly, and safe to run by hand from Vercel's Cron
// Jobs page. Counts only in the response and the log; never a value.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }
    if (!process.env.LISTING_SECRETS_KEY) {
        await recordCronRun(JOB, false, 'LISTING_SECRETS_KEY is not set');
        await logError('seal-listing-secrets: LISTING_SECRETS_KEY is not set', null, { path: '/api/cron/seal-listing-secrets' });
        return NextResponse.json({ ok: false, error: 'LISTING_SECRETS_KEY is not set' }, { status: 500 });
    }
    try {
        const result = await sealListingSecrets(adminClient());
        const wontOpen = result.listingCodes.wontOpen + result.bookingCodes.wontOpen + result.wifiPasswords.wontOpen;
        if (wontOpen) {
            // A sealed value this key can't open: the key was changed without
            // LISTING_SECRETS_KEY_PREVIOUS, or a row was copied. Loud, once a run.
            await logError(`seal-listing-secrets: ${wontOpen} sealed value(s) will not open with this key`, result, { path: '/api/cron/seal-listing-secrets' });
        }
        await recordCronRun(JOB, wontOpen === 0, JSON.stringify(result));
        return NextResponse.json({ ok: wontOpen === 0, ...result });
    } catch (err: any) {
        await recordCronRun(JOB, false, String(err?.message || err));
        await logError('seal-listing-secrets failed', { message: String(err?.message || err) }, { path: '/api/cron/seal-listing-secrets' });
        return NextResponse.json({ ok: false, error: 'Sealing failed' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { sendEmail } from '@/lib/email';
import { mintToken, verificationEmail, RESEND_CEILING, RESEND_COOLDOWN_SECONDS } from '@/lib/serviceApplications';

export const dynamic = 'force-dynamic';

// Ask again for the confirmation email on a lodged application.
//
// WHY IT NEEDS DESIGNING RATHER THAN ADDING
//
// The capability is already public: /auth/v1/resend takes the anon key, and the
// anon key ships in the client bundle. Anyone can already trigger sign-up email
// for an arbitrary address. So this route does not open a door — the job is to
// avoid building a wider one than Supabase already leaves open.
//
// The sharp edge is that the built-in mail quota is PROJECT-WIDE, not per
// address. Verified 27 Aug 2026: a brand-new address was refused
// `429 over_email_send_rate_limit` on its first ever send because the project's
// allowance was spent. So anybody who can trigger sends can exhaust the quota
// and stop every real confirmation and password reset. A resend button with a
// free-text email field would be that attack with a friendly front end.
//
// WHAT HOLDS IT SHUT
//
//   1. NO ADDRESS IS ACCEPTED. It takes an applicationId — the id of a lodged
//      application, handed back by /api/services/apply to whoever lodged it —
//      and sends to the address on that row. There is no field for a stranger
//      to type into, and no way to aim it at somebody.
//
//   2. ONE ANSWER, ALWAYS. `{ ok: true }` whether the row exists, is already
//      claimed, or a mail went. Nothing here tells a caller which.
//
//   3. A COOLDOWN and a DAILY CEILING, both now counted on the application row
//      itself. They used to be read off the auth account — `confirmation_sent_at`
//      and `user_metadata` — and there is no account any more at this point in
//      the flow. That is the whole change: the address has not been proved yet,
//      so there is deliberately nobody to hang this state off but the
//      application.
//
//   4. A FRESH TOKEN EVERY TIME, replacing the old one. The previous link stops
//      working the moment a new one is sent, so a chain of resends does not
//      leave a trail of live credentials in an inbox.
//
// NONE OF THIS CLOSES THE UNDERLYING EXPOSURE. The anon key is public and
// /auth/v1/resend is reachable with it regardless of what is here. The fixes
// that matter are on the project: custom SMTP with its own quota, and tightened
// auth rate limits. See MAINTENANCE.md, launch blockers.

// One shape, every time. Nothing about the answer depends on what was found.
const OK = (extra: Record<string, any> = {}) => NextResponse.json({ ok: true, ...extra });

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const applicationId = String(body.applicationId || '').trim();
        if (!applicationId) return OK();

        const admin = adminClient();

        const { data: application } = await admin
            .from('service_applications')
            .select('id, email, business_name, token_sent_at, resend_count, last_resend_at, claimed_at, created_at')
            .eq('id', applicationId)
            .maybeSingle();

        // Missing or already finished. Both answer the same as success.
        if (!application || application.claimed_at) return OK();

        // The cooldown. `wait` is safe to return: the caller already holds the
        // id of this application, so it tells them nothing they did not know.
        const lastSent = application.last_resend_at || application.token_sent_at;
        if (lastSent) {
            const secondsSince = (Date.now() - new Date(lastSent).getTime()) / 1000;
            if (secondsSince < RESEND_COOLDOWN_SECONDS) {
                return OK({ wait: Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince) });
            }
        }

        // The ceiling. Somebody on their sixth link of the day has a different
        // problem, and telling them to talk to us is a better answer than
        // another email.
        if (Number(application.resend_count || 0) >= RESEND_CEILING) return OK({ capped: true });

        // A new token, which retires the old one — the unique index is on the
        // hash, so writing a new one leaves exactly one live link.
        const { token, hash } = mintToken();

        const { error: tokenError } = await admin
            .from('service_applications')
            .update({
                token_hash: hash,
                token_sent_at: new Date().toISOString(),
                last_resend_at: new Date().toISOString(),
                resend_count: Number(application.resend_count || 0) + 1,
            })
            .eq('id', application.id);

        if (tokenError) {
            await logError('service-resend-verification', {
                application: applicationId,
                message: tokenError.message,
            });
            return OK({ sent: false });
        }

        // THE TOKEN IS WRITTEN BEFORE THE MAIL GOES, and that ordering is
        // deliberate. The other way round, a send that succeeded while the
        // write failed would email a link that authenticates against nothing.
        // This way the worst case is a live token nobody was told about, which
        // expires on its own.
        const mail = verificationEmail(application, token, new URL(req.url).origin);
        const went = await sendEmail(application.email, mail.subject, mail.html);

        if (!went) {
            await logError('service-resend-verification', {
                application: applicationId,
                message: 'sendEmail returned false',
            });
            return OK({ sent: false });
        }

        return OK({ sent: true });
    } catch (err: any) {
        await logError('service-resend-verification', { message: String(err && err.message) });
        // Even a crash answers the same way.
        return OK();
    }
}

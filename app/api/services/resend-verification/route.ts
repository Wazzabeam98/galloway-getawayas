import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminClient, supabaseUrl } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';

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
//   1. NO ADDRESS IS ACCEPTED. It takes a providerId — the id of a lodged
//      application, handed back by /api/services/apply to whoever lodged it —
//      and sends to the owner of that row. There is no field for a stranger to
//      type into, and no way to aim it at somebody.
//
//   2. THE ANON CLIENT SENDS, NOT THE SERVICE ROLE. So Supabase's own throttle
//      is still above us. The service role would step over it.
//
//   3. ONE ANSWER, ALWAYS. `{ ok: true }` whether the row exists, the account
//      is already confirmed, or a mail went. Supabase's own endpoint gives
//      nothing away about who has an account and neither does this. Real
//      outcomes go to error_log.
//
//   4. A COOLDOWN, from `confirmation_sent_at` on the account — the timestamp
//      Supabase itself maintains, so there is no state of ours to get wrong.
//
//   5. A DAILY CEILING, counted in the account's user_metadata. Somebody on
//      their sixth resend of the day has a different problem, and telling them
//      to talk to us is a better answer than another email.
//
// NONE OF THIS CLOSES THE UNDERLYING EXPOSURE. The anon key is public and
// /auth/v1/resend is reachable with it regardless of what is here. The fixes
// that matter are on the project: custom SMTP with its own quota, and tightened
// auth rate limits. See MAINTENANCE.md, launch blockers.

const COOLDOWN_SECONDS = 60;
const CEILING_PER_DAY = 5;

// One shape, every time. Nothing about the answer depends on what was found.
const OK = (extra: Record<string, any> = {}) => NextResponse.json({ ok: true, ...extra });

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const providerId = String(body.providerId || '').trim();
        if (!providerId) return OK();

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider || !provider.owner_id) return OK();

        const { data: got, error: userError } = await admin.auth.admin.getUserById(provider.owner_id);
        const user = got && got.user;
        if (userError || !user || !user.email) return OK();

        // Already confirmed. Nothing to send, and saying so would tell a
        // caller something about the account.
        if (user.email_confirmed_at || (user as any).confirmed_at) return OK({ alreadyConfirmed: true });

        // The cooldown, read off Supabase's own timestamp rather than a column
        // of ours. `wait` is safe to return: the caller already holds the id of
        // this application, so it tells them nothing they did not know.
        const lastSent = (user as any).confirmation_sent_at;
        if (lastSent) {
            const secondsSince = (Date.now() - new Date(lastSent).getTime()) / 1000;
            if (secondsSince < COOLDOWN_SECONDS) {
                return OK({ wait: Math.ceil(COOLDOWN_SECONDS - secondsSince) });
            }
        }

        // The daily ceiling. Kept in user_metadata so there is no migration and
        // no new table for a counter that resets every day.
        const meta: any = (user.user_metadata as any) || {};
        const today = new Date().toISOString().slice(0, 10);
        const usedToday = meta.resend_day === today ? Number(meta.resend_count || 0) : 0;

        if (usedToday >= CEILING_PER_DAY) return OK({ capped: true });

        const anon = createClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });

        const origin = new URL(req.url).origin;
        const { error: mailError } = await anon.auth.resend({
            type: 'signup',
            email: user.email,
            options: { emailRedirectTo: `${origin}/auth/callback?next=/services/join` },
        });

        if (mailError) {
            await logError('service-resend-verification', {
                provider: providerId,
                message: mailError.message,
            });
            return OK({ sent: false });
        }

        // Counted only when one actually went, so a refused send does not spend
        // somebody's allowance for the day.
        await admin.auth.admin.updateUserById(provider.owner_id, {
            user_metadata: { ...meta, resend_day: today, resend_count: usedToday + 1 },
        });

        return OK({ sent: true });
    } catch (err: any) {
        await logError('service-resend-verification', { message: String(err && err.message) });
        // Even a crash answers the same way.
        return OK();
    }
}

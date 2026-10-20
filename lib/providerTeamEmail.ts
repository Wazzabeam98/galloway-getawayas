// Co-hosts of a business — an experience or a trade — get the same emails as the
// owner for anything their permissions cover (and, since every email records
// its push, the same pushes). Done once, here, where every email passes through
// (lib/email sendEmail), rather than at the twenty-odd places a business is
// emailed — one of which is the payment webhook, a money-path file.
//
// HOW IT KNOWS. A business is emailed at its contact address. The push rule the
// subject matches (lib/pushRules) names the permission that covers it in
// `team` — a new booking is bookings, a payout is earnings — and has none for
// what stays the owner's (subscription, payout set-up). So: the subject's rule
// has a team permission, AND the address is a business's contact address → the
// active co-hosts on that business holding the permission get a copy, at their
// own sign-in address.
//
// Never throws and is time-boxed: a co-host's copy must never hold up or fail
// the owner's email or the booking it rides along with.

import { adminClient } from './supabaseAdmin';
import { pushForEmail } from './pushRules';

function enabled(): boolean {
    return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const exactly = (email: string) => email.replace(/[\\%_]/g, '\\$&');

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
    });
}

/** The co-host addresses that should get a copy of this email. */
export async function providerTeamCopies(to: string, subject: string, html: string, client?: any): Promise<string[]> {
    try {
        const spec = pushForEmail(subject, html);
        const permission = spec && spec.team;
        if (!permission || !to) return [];
        if (!client && !enabled()) return [];
        const admin = client || adminClient();
        const address = String(to).trim().toLowerCase();
        const run = async (): Promise<string[]> => {
            const { data: providers } = await admin
                .from('service_providers')
                .select('id')
                .ilike('contact_email', exactly(address))
                .limit(5);
            let ids = (providers || []).map((p: any) => p.id);
            // A few business emails go to the owner's sign-in address instead (an
            // imported calendar that stopped syncing). Those link into the business
            // dashboard; a host email to the same person links to /dashboard and
            // never reaches here, so it is never copied to a business's co-hosts.
            if (!ids.length && spec && String(spec.url || '').startsWith('/services/')) {
                const { data: owner } = await admin.from('profiles').select('id').ilike('email', exactly(address)).limit(1);
                if (owner && owner[0]) {
                    const { data: owned } = await admin.from('service_providers').select('id').eq('owner_id', owner[0].id);
                    ids = (owned || []).map((p: any) => p.id);
                }
            }
            if (!ids.length) return [];
            const { data: grants } = await admin
                .from('provider_access')
                .select('email, user_id')
                .in('provider_id', ids)
                .eq('status', 'active')
                .eq(permission, true);
            const out = new Set<string>();
            for (const g of grants || []) {
                const e = String(g.email || '').trim().toLowerCase();
                if (g.user_id && e && e !== address) out.add(e);
            }
            return Array.from(out);
        };
        return (await within(run(), 4000)) || [];
    } catch {
        return [];
    }
}

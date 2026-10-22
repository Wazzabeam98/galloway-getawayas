import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { getOrCreateReferralCode, REFERRAL_REWARD_GBP, ReferralRow } from '@/lib/referrals';
import { SITE_URL } from '@/lib/email';
import { greetingName } from '@/lib/utils';
import ReferHost, { ReferralListItem } from '@/components/referrals/ReferHost';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Refer a host · Galloway Getaways',
};

// The referrer's own page: their personal link, the ways to share it, and how
// their referrals are getting on. Any signed-in user may refer — guest or host.
export default async function ReferPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData && userData.user && userData.user.id;

    if (!uid) {
        // Not signed in — show the offer and send them to sign in. Signing in is
        // the one thing a link needs an account for.
        return (
            <main className="min-h-screen bg-slate-50">
                <div className="max-w-2xl mx-auto px-6 py-16">
                    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <h1 className="text-3xl font-bold text-slate-900">Refer a host, get £{REFERRAL_REWARD_GBP}</h1>
                        <p className="mt-4 text-lg text-slate-700">
                            Know someone with a holiday let? Refer them and get £{REFERRAL_REWARD_GBP} when
                            they host their first stay. They’ll pay no commission on their first booking.
                        </p>
                        <Link
                            href="/?signin=1"
                            className="mt-8 inline-flex rounded-xl bg-emerald-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-emerald-800"
                        >
                            Sign in to get your link
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    const admin = adminClient();
    const code = await getOrCreateReferralCode(admin, uid);
    const link = (SITE_URL || '') + '/refer/' + (code || '');

    const { data: rows } = await admin
        .from('referrals')
        .select('*')
        .eq('referrer_id', uid)
        .order('created_at', { ascending: false });

    const referrals = (rows || []) as ReferralRow[];

    // First names of the people referred (and the referrer themselves, for the
    // greeting), in one query. First names only.
    const referredIds = Array.from(new Set(referrals.map((r) => r.referred_user_id)));
    const wantIds = Array.from(new Set([uid, ...referredIds]));
    const nameById: Record<string, string> = {};
    const { data: profiles } = await admin
        .from('profiles')
        .select('id, first_name, preferred_name, full_name')
        .in('id', wantIds);
    (profiles || []).forEach((p: any) => {
        nameById[p.id] = greetingName(p, '');
    });

    const items: ReferralListItem[] = referrals.map((r) => ({
        id: r.id,
        status: r.status,
        name: nameById[r.referred_user_id] || 'A new host',
        createdAt: r.created_at,
        rewardAmount: r.reward_amount,
        rewardPaidAt: r.reward_paid_at,
    }));

    const myFirst = nameById[uid] || '';

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-2xl mx-auto px-6 py-12">
                <ReferHost code={code || ''} link={link} items={items} firstName={myFirst} />
            </div>
        </main>
    );
}

import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { getOrCreateReferralCode, ReferralRow, ReferralType, REFERRAL_REWARD_MAX } from '@/lib/referrals';
import { SITE_URL } from '@/lib/email';
import { greetingName } from '@/lib/utils';
import ReferHost, { ReferralListItem } from '@/components/referrals/ReferHost';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    // The root layout appends ' | Galloway Getaways'; saying it here as well
    // put the brand in the title twice.
    title: 'Refer a host, earn cash',
    description: 'Refer a holiday let, experience or service to Galloway Getaways and earn up to £' + REFERRAL_REWARD_MAX + '.',
    alternates: { canonical: '/refer' },
};

const VALID_TYPES: ReferralType[] = ['stay', 'experience', 'trade'];

// Public "Refer a host, earn cash" page — works signed out (shows the three
// cards; picking one opens sign-in and returns here) and signed in (the person's
// link, share and QR, and their referrals). Any signed-in user may refer.
export default async function ReferPage({ searchParams }: { searchParams: { type?: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData && userData.user && userData.user.id;

    // No card is chosen until the person picks one (like Airbnb's). The only
    // preselection is an explicit ?type= — set when a signed-out visitor picks a
    // card and signs in, or on a link straight to one kind.
    const paramType = searchParams && searchParams.type;
    const defaultType: ReferralType | null = VALID_TYPES.includes(paramType as ReferralType) ? (paramType as ReferralType) : null;

    if (!uid) {
        return (
            <main className="min-h-screen bg-slate-50">
                <div className="max-w-2xl mx-auto px-6 py-12">
                    <ReferHost signedIn={false} link={null} items={[]} defaultType={defaultType} />
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

    const referredIds = Array.from(new Set(referrals.map((r) => r.referred_user_id)));
    const nameById: Record<string, string> = {};
    if (referredIds.length) {
        const { data: profiles } = await admin
            .from('profiles')
            .select('id, first_name, preferred_name, full_name')
            .in('id', referredIds);
        (profiles || []).forEach((p: any) => { nameById[p.id] = greetingName(p, ''); });
    }

    const items: ReferralListItem[] = referrals.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        name: nameById[r.referred_user_id] || 'Someone new',
        createdAt: r.created_at,
        rewardAmount: r.reward_amount,
        rewardPaidAt: r.reward_paid_at,
    }));

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-2xl mx-auto px-6 py-12">
                <ReferHost signedIn={true} link={link} items={items} defaultType={defaultType} />
            </div>
        </main>
    );
}

import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { adminName } from '@/lib/utils';
import ReferralsAdmin, { AdminReferralRow } from '@/components/admin/ReferralsAdmin';

export const dynamic = 'force-dynamic';

// Owner-only referrals view: every referral and where it has got to, with a
// "Mark paid" button on the rewards that are due. Gate on the server before
// anything renders; read with the service role, since the referrals table is
// never granted to a browser role.
export default async function ReferralsAdminPage() {
    await requireAdmin();
    const admin = adminClient();

    const { data: rows } = await admin
        .from('referrals')
        .select('id, referrer_id, referred_user_id, status, reward_amount, waived_commission, reward_due_at, reward_paid_at, created_at')
        .order('created_at', { ascending: false });

    const referrals = rows || [];

    const ids = Array.from(
        new Set(referrals.flatMap((r: any) => [r.referrer_id, r.referred_user_id]).filter(Boolean))
    );
    const nameById: Record<string, string> = {};
    if (ids.length) {
        const { data: profiles } = await admin
            .from('profiles')
            .select('id, full_name, first_name, last_name, preferred_name')
            .in('id', ids);
        (profiles || []).forEach((p: any) => {
            nameById[p.id] = adminName(p, 'User');
        });
    }

    const items: AdminReferralRow[] = referrals.map((r: any) => ({
        id: r.id,
        referrerName: nameById[r.referrer_id] || 'User',
        referredName: nameById[r.referred_user_id] || 'User',
        status: r.status,
        rewardAmount: r.reward_amount,
        waivedCommission: r.waived_commission,
        rewardDueAt: r.reward_due_at,
        rewardPaidAt: r.reward_paid_at,
        createdAt: r.created_at,
    }));

    return <ReferralsAdmin rows={items} />;
}

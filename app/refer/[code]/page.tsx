import Link from 'next/link';
import type { Metadata } from 'next';
import { adminClient } from '@/lib/supabaseAdmin';
import { referrerForCode, REFERRAL_REWARD_GBP } from '@/lib/referrals';
import { greetingName } from '@/lib/utils';
import ReferralCapture from '@/components/referrals/ReferralCapture';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'You’ve been invited to host · Galloway Getaways',
    description: 'List your holiday let on Galloway Getaways and pay no commission on your first booking.',
};

// The page a referral link lands on. It explains the offer and drops the cookie
// (via ReferralCapture) that remembers who referred this visitor, so the
// referral can be attached when they go on to list. The code is validated so a
// stale link just shows the generic offer rather than naming a referrer.
export default async function ReferralLanding({ params }: { params: { code: string } }) {
    const code = String(params.code || '').trim().toUpperCase();

    const admin = adminClient();
    const referrerId = await referrerForCode(admin, code);

    let referrerFirst = '';
    if (referrerId) {
        const { data } = await admin
            .from('profiles')
            .select('first_name, preferred_name, full_name')
            .eq('id', referrerId)
            .maybeSingle();
        referrerFirst = greetingName(data, '');
    }

    return (
        <main className="min-h-screen bg-slate-50">
            {referrerId && <ReferralCapture code={code} />}

            <div className="max-w-2xl mx-auto px-6 py-16">
                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                    <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
                        An invitation to host
                    </p>
                    <h1 className="mt-3 text-3xl font-bold text-slate-900">
                        {referrerFirst
                            ? referrerFirst + ' thinks you should host with us'
                            : 'Host your holiday let with us'}
                    </h1>
                    <p className="mt-4 text-lg text-slate-700">
                        List your property on Galloway Getaways and{' '}
                        <strong>pay no commission on your first booking</strong>. Guests book and
                        pay direct, you keep more than the big platforms leave you, and there’s no
                        platform fee for your guests.
                    </p>

                    <Link
                        href="/business"
                        className="mt-8 inline-flex rounded-xl bg-emerald-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-emerald-800"
                    >
                        List your property
                    </Link>

                    <p className="mt-6 text-sm text-slate-500">
                        Already have properties elsewhere? You can sync your calendar so you’re
                        never double-booked.
                    </p>
                </div>

                <p className="mt-6 text-center text-sm text-slate-500">
                    Know someone else with a holiday let? Once you’re hosting, you can refer them
                    too and earn £{REFERRAL_REWARD_GBP} each.
                </p>
            </div>
        </main>
    );
}

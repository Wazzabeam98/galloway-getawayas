import Link from 'next/link';
import type { Metadata } from 'next';
import { adminClient } from '@/lib/supabaseAdmin';
import { referrerForCode } from '@/lib/referrals';
import { greetingName } from '@/lib/utils';
import ReferralCapture from '@/components/referrals/ReferralCapture';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'You’ve been invited to Galloway Getaways',
    description: 'List a holiday let or experience and pay no commission on your first booking, or offer a service and get six months free.',
};

// The page a referral link lands on. It explains the offer to the person being
// referred and drops the cookie (via ReferralCapture) that remembers who
// referred them, so the referral attaches when they go on to list a holiday let,
// run an experience, or offer a service. A stale code just shows the generic
// offer rather than naming a referrer.
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
                        An invitation to Galloway Getaways
                    </p>
                    <h1 className="mt-3 text-3xl font-bold text-slate-900">
                        {referrerFirst
                            ? referrerFirst + ' thinks you should join us'
                            : 'Join Galloway Getaways'}
                    </h1>
                    <p className="mt-4 text-lg text-slate-700">
                        List a holiday let or run an experience and{' '}
                        <strong>pay no commission on your first booking</strong> — or offer a
                        service and get <strong>six months free</strong>. Guests book and pay direct,
                        and you keep more than the big platforms leave you.
                    </p>

                    <div className="mt-8 flex flex-wrap gap-3">
                        <Link
                            href="/business"
                            className="inline-flex rounded-xl bg-emerald-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-emerald-800"
                        >
                            List a holiday let
                        </Link>
                        <Link
                            href="/services"
                            className="inline-flex rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 transition hover:border-slate-400"
                        >
                            Offer an experience or service
                        </Link>
                    </div>

                    <p className="mt-6 text-sm text-slate-500">
                        Already somewhere else? You can sync your calendar so you’re never
                        double-booked.
                    </p>
                </div>
            </div>
        </main>
    );
}

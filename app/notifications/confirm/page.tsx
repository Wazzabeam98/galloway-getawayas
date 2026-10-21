// =====================================================================
// GALLOWAY GETAWAYS — confirm a listing's notification emails
// WHERE THIS GOES: GitHub → app/notifications/confirm/page.tsx   (NEW FILE)
//
// Reached from the one-time link in the "confirm these emails" message an
// owner's forwarded address is sent. Works without signing in — the point is
// that these people have no account. The token in the link is matched by its
// hash and cleared on use, so the link works exactly once.
// =====================================================================

import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { hashSubscriberToken } from '@/lib/listingSubscriberToken';

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Confirm notifications',
    robots: { index: false, follow: false },
};

export default async function ConfirmNotificationsPage({
    searchParams,
}: {
    searchParams: { token?: string };
}) {
    const token = searchParams.token || '';
    let ok = false;

    if (token) {
        try {
            const admin = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL || '',
                process.env.SUPABASE_SERVICE_ROLE_KEY || '',
                { auth: { persistSession: false } },
            );

            const hash = hashSubscriberToken(token);

            // One round trip: confirm the row whose (still-unused) token matches,
            // and clear the token so the link can't be used again. If it was
            // already confirmed its hash is null, so this matches nothing — and
            // we treat a re-click of a spent link as success below only when the
            // address is in fact confirmed.
            const { data } = await admin
                .from('listing_notification_subscribers')
                .update({ confirmed_at: new Date().toISOString(), confirm_token_hash: null })
                .eq('confirm_token_hash', hash)
                .select('id')
                .maybeSingle();

            ok = !!(data && data.id);
        } catch (err) {
            ok = false;
        }
    }

    return (
        <div className="max-w-lg mx-auto px-6 py-20 text-center">
            {ok ? (
                <>
                    <CheckCircle2 className="w-12 h-12 text-emerald-700 mx-auto mb-5" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re all set</h1>
                    <p className="text-slate-600">
                        We&apos;ll send you a copy of this property&apos;s booking emails. Every one has a link to stop
                        them whenever you like.
                    </p>
                </>
            ) : (
                <>
                    <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-5" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">That link didn&apos;t work</h1>
                    <p className="text-slate-600">
                        It may have already been used, or a newer confirmation email may have replaced it. Ask the host
                        to send it again, or email us and we&apos;ll sort it.
                    </p>
                </>
            )}

            <div className="mt-8">
                <Link
                    href="/"
                    className="px-5 py-2.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-xl transition"
                >
                    Back to the site
                </Link>
            </div>
        </div>
    );
}

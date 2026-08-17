// =====================================================================
// GALLOWAY GETAWAYS — unsubscribe landing page
// WHERE THIS GOES: GitHub → app/unsubscribe/page.tsx   (NEW FILE)
//
// Reached from the link in the footer of optional emails. Works without
// signing in, which is the point — the token in the link identifies the
// account and nothing else.
// =====================================================================

import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Unsubscribe',
    robots: { index: false, follow: false },
};

const COLUMNS: Record<string, string> = {
    new_message: 'message alerts',
    booking_reminders: 'trip reminders',
    review_prompts: 'review reminders',
    marketing: 'news and offers',
};

export default async function UnsubscribePage({
    searchParams,
}: {
    searchParams: { token?: string; type?: string };
}) {
    const token = searchParams.token || '';
    const type = searchParams.type && COLUMNS[searchParams.type] ? searchParams.type : 'marketing';

    let ok = false;

    if (token) {
        try {
            const admin = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL || '',
                process.env.SUPABASE_SERVICE_ROLE_KEY || '',
                { auth: { persistSession: false } }
            );

            const patch: Record<string, any> = { updated_at: new Date().toISOString() };
            patch[type] = false;

            const { error } = await admin
                .from('notification_preferences')
                .update(patch)
                .eq('unsubscribe_token', token);

            ok = !error;
        } catch (err) {
            ok = false;
        }
    }

    return (
        <div className="max-w-lg mx-auto px-6 py-20 text-center">
            {ok ? (
                <>
                    <CheckCircle2 className="w-12 h-12 text-emerald-700 mx-auto mb-5" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re unsubscribed</h1>
                    <p className="text-slate-600">
                        We won&apos;t email you about {COLUMNS[type]} again. You&apos;ll still get emails about your
                        own bookings, because those are part of the service.
                    </p>
                </>
            ) : (
                <>
                    <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-5" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">That link didn&apos;t work</h1>
                    <p className="text-slate-600">
                        It may have expired or been copied incompletely. You can change any of these settings under
                        Account settings, or email us and we&apos;ll sort it.
                    </p>
                </>
            )}

            <div className="mt-8 flex items-center justify-center gap-3">
                <Link
                    href="/account"
                    className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                >
                    Notification settings
                </Link>
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

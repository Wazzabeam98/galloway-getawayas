export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { tradeLabel } from '@/lib/serviceProviders';
import ProviderUpcoming from '@/components/services/ProviderUpcoming';
import { loadProviderReservations } from '@/lib/providerReservations';

export const metadata = {
    title: 'Your reservations',
    robots: { index: false, follow: false },
};

// THE RESERVATIONS HOME.
//
// This used to be reservations AND the calendar/workspace on one page, so the
// "Your reservations" and "Calendar" menu items landed in the same place. They
// are split now (Airbnb's shape): this page is the upcoming list + reservation
// card + summary only; /services/dashboard/calendar is the calendar, availability
// and blocking. Both are a click apart in the menu.
export default async function ProviderReservationsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();

    const { data: providers } = await admin
        .from('service_providers')
        .select('id, business_name, trade, audience, status, fulfilment, photos')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

    const list = providers || [];
    if (list.length === 0) {
        return (
            <div className="max-w-lg mx-auto px-4 py-20 text-center">
                <h1 className="text-2xl font-extrabold text-slate-900">No business here yet</h1>
                <p className="mt-3 text-slate-600">
                    This account doesn&rsquo;t have a service business. If you run one locally — a trade for
                    property owners, or an experience for guests — you can list it.
                </p>
                <Link href="/business" className="inline-flex mt-6 items-center gap-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl px-5 py-3">
                    List your business
                </Link>
            </div>
        );
    }

    const provider = list.find((p) => p.status === 'approved') || list[0];
    if (provider.status !== 'approved') {
        redirect(`/services/join?trade=${provider.trade}`);
    }

    const { reservations, summary } = await loadProviderReservations(admin, provider);

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                        {provider.business_name}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">{tradeLabel(provider.trade)}</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/services/dashboard/calendar" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                        Calendar
                    </Link>
                    <Link href="/services/dashboard/edit" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                        Your listing
                    </Link>
                </div>
            </div>

            <ProviderUpcoming reservations={reservations} summary={summary} />
        </div>
    );
}

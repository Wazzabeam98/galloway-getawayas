export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { tradeLabel } from '@/lib/serviceProviders';
import { ukDate } from '@/lib/dayKey';
import ProviderUpcoming from '@/components/services/ProviderUpcoming';
import { loadProviderReservations } from '@/lib/providerReservations';

export const metadata = {
    // A trade thinks "requests", a host thinks "bookings"; both land here.
    title: 'Requests',
    robots: { index: false, follow: false },
};

// THE REQUESTS / RESERVATIONS HOME.
//
// A trade's home is Requests — every enquiry to answer and every job they have
// accepted, on the shared reservation card, with Accept / Decline on the request
// itself and a Past-work toggle. A guest provider's home is the same page worded
// as their reservations. The month grid and blocking live one click away at
// /services/dashboard/calendar; the listing editor at /services/dashboard/edit.
export default async function ProviderReservationsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();

    const { data: providers } = await admin
        .from('service_providers')
        .select('id, business_name, trade, audience, status, plan, stripe_payouts_enabled, trial_ends_at, fulfilment, photos, cancellation_window_hours, guest_details, collection_street, collection_town, collection_postcode')
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

    const { reservations, past, summary } = await loadProviderReservations(admin, provider);

    const isTrade = provider.audience !== 'guest';
    // A trade is "Listed" the moment they are approved (they are paid off-platform,
    // so there is no payout to connect); the pill reads the same as the one the old
    // dashboard showed. The subscription line is their six-month free date, in
    // DD/MM/YYYY from the shared formatter, and says so honestly before the clock
    // has started (it starts on their first enquiry).
    const offPlatform = provider.plan === 'subscription';
    const trialEnd: string | null = provider.trial_ends_at || null;
    const subscriptionLabel = isTrade && offPlatform
        ? (trialEnd ? 'Free until ' + ukDate(trialEnd) : 'Free for six months from your first enquiry')
        : null;

    // The page heading reads like a host's dashboard: the section name (the top
    // bar already greets them by first name), with the business name as the quiet
    // line beneath — not a big business-name H1 competing with "Welcome, Ewan".
    const heading = isTrade ? 'Requests' : 'Your reservations';

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                        {heading}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">
                        {provider.business_name}
                        <span className="text-slate-300"> · </span>
                        {tradeLabel(provider.trade)}
                    </p>
                    {subscriptionLabel && (
                        <p className="mt-1 text-sm font-semibold text-emerald-700">{subscriptionLabel}</p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {isTrade && offPlatform && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            Listed · hosts can find you
                        </span>
                    )}
                    <Link href="/services/dashboard/calendar" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                        Calendar
                    </Link>
                    <Link href="/services/dashboard/edit" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                        Your listing
                    </Link>
                </div>
            </div>

            <ProviderUpcoming reservations={reservations} past={past} summary={summary} title={isTrade ? null : 'Upcoming reservations'} />
        </div>
    );
}

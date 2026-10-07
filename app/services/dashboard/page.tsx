export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { tradeLabel } from '@/lib/serviceProviders';
import { firstName } from '@/lib/utils';
import { ukDateTime } from '@/lib/dayKey';
import ProviderUpcoming from '@/components/services/ProviderUpcoming';
import { loadProviderReservations } from '@/lib/providerReservations';

export const metadata = {
    // One static tab title for both audiences. The visible heading carries the
    // audience's own noun ("Enquiries" for a trade, "Your bookings" for a guest
    // experience provider); the tab title stays neutral so a guest provider's tab
    // does not read "Enquiries", the trade noun. Making it audience-specific would
    // cost a second auth+provider query here purely for a tab title.
    title: 'Your dashboard',
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

    // Price-on-enquiry / range enquiries — a guest experience only. Shown here so
    // a provider sees a guest's question on the platform, not only in the email
    // that was sent when it landed. The guest's first name (the site's rule).
    const { data: enquiryRows } = !isTrade
        ? await admin
            .from('experience_enquiries')
            .select('id, guest_id, item_name, message, created_at')
            .eq('provider_id', provider.id)
            .order('created_at', { ascending: false })
            .limit(50)
        : { data: [] as any[] };
    const enquiries = enquiryRows || [];
    const enquiryGuestIds = Array.from(new Set(enquiries.map((e: any) => e.guest_id).filter(Boolean)));
    const { data: enquiryGuests } = enquiryGuestIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name').in('id', enquiryGuestIds)
        : { data: [] as any[] };
    const enquiryGuestName: Record<string, string> = {};
    for (const g of enquiryGuests || []) enquiryGuestName[g.id] = firstName(g, 'A guest');

    // The page heading reads like a host's dashboard: the section name (the top
    // bar already greets them by first name), with the business name as the quiet
    // line beneath — not a big business-name H1 competing with "Welcome, Ewan".
    // Subscription state ("Free until …") and the "Listed" pill used to sit here;
    // they belong to the business, not to this inbox, so they moved to Your
    // listing (round six).
    // A guest-experience provider takes "bookings" for their experiences, not
    // "reservations" for a property — that is the accommodation host's noun, and
    // it does not belong on a chef's or a class's dashboard.
    const heading = isTrade ? 'Enquiries' : 'Your bookings';

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
                </div>
                {/* A trade's in-page nav duplicated the account menu (Calendar, Your
                    listing), so it is gone — the menu is the one place to move
                    around. A guest provider keeps its quick links. */}
                {!isTrade && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Link href="/services/dashboard/calendar" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                            Calendar
                        </Link>
                        <Link href="/services/dashboard/edit" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                            Your listing
                        </Link>
                    </div>
                )}
            </div>

            {!isTrade && enquiries.length > 0 && (
                <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
                    <h2 className="text-lg font-bold text-slate-900">Enquiries</h2>
                    <p className="mt-0.5 mb-4 text-sm text-slate-500">Guests asking about a price. Reply to agree one.</p>
                    <ul className="space-y-3">
                        {enquiries.map((e: any) => (
                            <li key={e.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="font-semibold text-slate-900">
                                        {enquiryGuestName[e.guest_id] || 'A guest'}
                                        {e.item_name ? <span className="font-normal text-slate-500"> · {e.item_name}</span> : null}
                                    </span>
                                    <span className="text-xs text-slate-400">{ukDateTime(e.created_at)}</span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{e.message}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <ProviderUpcoming reservations={reservations} past={past} summary={summary} title={isTrade ? null : 'Upcoming bookings'} folders={isTrade} />
        </div>
    );
}

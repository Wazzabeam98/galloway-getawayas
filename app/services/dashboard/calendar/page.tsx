export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { requestedWhen, windowsClash } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';
import TradeCalendar from '@/components/services/TradeCalendar';
import ProviderExperienceDashboard from '@/components/services/ProviderExperienceDashboard';
import ProviderSlotDashboard from '@/components/services/ProviderSlotDashboard';
import ExperienceIcalFeeds from '@/components/services/ExperienceIcalFeeds';
import { shapeOf } from '@/lib/serviceSlots';
import { isLiveToGuests, isAwaitingConnect } from '@/lib/serviceOrders';
import { loadHeldOrders, heldSummary } from '@/lib/heldPayouts';
import HeldPayoutsBanner from '@/components/services/HeldPayoutsBanner';

export const metadata = {
    title: 'Your calendar',
    robots: { index: false, follow: false },
};

const LONDON = 'Europe/London';

function todayKey(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
}

export default async function ProviderDashboardPage() {
    const supabase = createServerComponentClient({ cookies });
    // getUser(), not getSession() — the page keys authorization off who this is.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();

    // The provider(s) this account owns. Approved first, then the most recently
    // touched — a signed-in owner with a live business lands on it, not on a
    // half-finished draft for a second trade.
    const { data: providers } = await admin
        .from('service_providers')
        .select('id, business_name, trade, audience, plan, status, stripe_payouts_enabled, stripe_account_id, owner_paused, admin_hidden_at, trial_ends_at, approved_at, callout_fee, shape, fulfilment, photos')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

    const list = providers || [];
    if (list.length === 0) {
        // Signed in, but no business on this account. Point at the way in
        // rather than 404 — this is where "become a provider" would live.
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

    // Not approved yet: the dashboard proper is for a live business. A pending
    // or returned application belongs back in the wizard, with its note.
    if (provider.status !== 'approved') {
        redirect(`/services/join?trade=${provider.trade}`);
    }

    // A GUEST-TRADE PROVIDER GETS A DIFFERENT HOME.
    //
    // Everything below this point is the host/enquiry model — a "Requests"
    // inbox read from service_enquiries, a rates-and-registrations profile card,
    // "you're listed". A chef has none of that: they receive service_orders, are
    // paid through the platform, and their screen is payouts + orders to
    // confirm. Rendering the host dashboard for them showed an inbox that could
    // never fill and chips for rates and coverage they do not have. So they
    // branch here, to their own dashboard, rather than being shown a plumber's.
    if (provider.audience === 'guest') {
        // A slot provider's home is a CALENDAR — a three-column workspace that
        // wants room; everyone else keeps the narrow inbox column.
        const isSlotHome = shapeOf(provider) === 'slot';
        // The export secret for the iCal panel — read here under the service role
        // (it's revoked from the browser roles) and handed to the provider's own
        // dashboard, the way the cottage editor shows a listing's export link.
        let icalToken = '';
        if (isSlotHome) {
            const { data: tok } = await admin
                .from('service_providers').select('ical_token').eq('id', provider.id).maybeSingle();
            icalToken = (tok && tok.ical_token) || '';
        }
        // Live before payouts are set up; the share they're owed is held — say how much.
        const awaitingPayouts = isAwaitingConnect(provider);
        const held = awaitingPayouts ? heldSummary(await loadHeldOrders(admin, [provider.id]).catch(() => []), todayKey()) : null;
        return (
            <div className={`${isSlotHome ? 'max-w-6xl' : 'max-w-2xl'} mx-auto px-4 sm:px-6 py-8 pb-24`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                            {provider.business_name}
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">
                            {tradeLabel(provider.trade)}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Link
                            href="/services/dashboard"
                            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500"
                        >
                            Reservations
                        </Link>
                        {/* Same route as the nav menu's "Your listing" — /services/
                            dashboard/edit is the one edit door (it forks a guest to the
                            sectioned listing editor, a trade to the business editor). */}
                        <Link
                            href="/services/dashboard/edit"
                            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500"
                        >
                            Your listing
                        </Link>
                    </div>
                </div>

                {awaitingPayouts && (
                    <div className="mt-6">
                        <HeldPayoutsBanner providerId={provider.id} held={held} connected={!!provider.stripe_account_id} />
                    </div>
                )}

                {/* Two homes by shape: a slot provider gets a CALENDAR (a booked
                    week, nothing to approve), everyone else the INBOX (requests
                    to confirm, then coming up). */}
                {isSlotHome
                    ? (
                        <div className="space-y-6">
                            <ProviderSlotDashboard providerId={provider.id} editHref="/services/dashboard/listing" live={isLiveToGuests(provider)} />
                            <ExperienceIcalFeeds providerId={provider.id} icalToken={icalToken} />
                        </div>
                    )
                    : <ProviderExperienceDashboard providerId={provider.id} live={isLiveToGuests(provider)} payoutsReady={!awaitingPayouts} />}
            </div>
        );
    }

    // A HOST-TRADE'S CALENDAR — the same month grid a host gets, showing the jobs
    // they have accepted on the days the owner asked for, and letting them take a
    // day off the way a host blocks a date.
    const today = todayKey();

    // Accepted jobs with a day, as calendar events. A job is "asked for", never a
    // slot committed to — the marker's hover text says so.
    const { data: acceptedRows } = await admin
        .from('service_enquiries')
        .select('id, summary, preferred_date, window_from, window_to, host_name')
        .eq('provider_id', provider.id)
        .eq('status', 'accepted');
    const firstNameOf = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || 'the owner';
    const datedJobs = (acceptedRows || []).filter((e: any) => e.preferred_date);
    const jobs = datedJobs.map((e: any) => {
        const rw = requestedWhen(e);
        const windowFull = rw ? rw.replace(/^Asked for [^,]+,\s*/, '') : 'a time to agree';
        // Tighten for the small calendar cell: "between 9am and 12pm" -> "9am–12pm",
        // "any time that day" -> "any time". The full phrasing stays in the hover.
        const window = windowFull
            .replace(/^between /, '')
            .replace(/ and /, '–')
            .replace(/^any time that day$/, 'any time');
        return {
            // The enquiry id, so clicking the day opens that enquiry on the
            // Requests page (the Accepted folder), the way a host opens a booking.
            id: String(e.id),
            dayKey: String(e.preferred_date).slice(0, 10),
            title: e.summary || 'Job',
            window,
            hostFirst: firstNameOf(e.host_name),
        };
    });

    // Days where two accepted jobs overlap in the same window — the soft double-
    // book, made visible. Never blocked; the calendar just flags it amber.
    const byDay: Record<string, any[]> = {};
    for (const e of datedJobs) {
        const k = String(e.preferred_date).slice(0, 10);
        (byDay[k] = byDay[k] || []).push(e);
    }
    const clashDays = Object.keys(byDay).filter((k) => {
        const list = byDay[k];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                if (windowsClash(list[i], list[j])) return true;
            }
        }
        return false;
    });

    // Days already taken off (future), from the shared whole-day block table.
    const { data: blocks } = await admin
        .from('slot_blocks')
        .select('blocked_date')
        .eq('provider_id', provider.id)
        .gte('blocked_date', today);
    const blockedDays = (blocks || []).map((b: any) => String(b.blocked_date).slice(0, 10));

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-24">
            {/* No in-page nav here: Enquiries and Your listing both live in the
                account menu, and repeating them was the duplication round six
                removed. */}
            <div className="mb-6">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Calendar</h1>
                <p className="mt-1 text-sm text-slate-500">
                    {provider.business_name}
                    <span className="text-slate-300"> · </span>
                    {tradeLabel(provider.trade)}
                </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
                <TradeCalendar providerId={provider.id} jobs={jobs} blockedDays={blockedDays} clashDays={clashDays} />
            </div>
        </div>
    );
}

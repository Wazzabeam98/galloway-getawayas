export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel, schemeLabel, registrationVerified } from '@/lib/serviceProviders';
import ProviderDashboard, {
    DashboardEnquiry,
    DashboardUpcoming,
} from '@/components/services/ProviderDashboard';

export const metadata = {
    title: 'Your business',
    robots: { index: false, follow: false },
};

const LONDON = 'Europe/London';

function todayKey(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
}

// "21 Aug" — a bare day for something already dealt with.
function shortDay(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: LONDON });
}

// "Thu 6pm" — a deadline, weekday and hour, for a request still to answer.
function replyByLabel(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: LONDON });
    const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', hour12: true, timeZone: LONDON }).replace(' ', '');
    return `${day} ${time}`;
}

// 'gatehouse_of_fleet' → 'Gatehouse Of Fleet'. The enquiry stores an area key,
// not a display name; this is the readable form for the sub-line.
function prettyArea(key: string | null | undefined): string {
    return String(key || '')
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function chipFor(status: string): { chip: DashboardEnquiry['chip']; label: string } {
    if (status === 'sent' || status === 'viewed') return { chip: 'new', label: 'New' };
    if (status === 'accepted') return { chip: 'accepted', label: 'Accepted' };
    if (status === 'declined') return { chip: 'declined', label: 'Declined' };
    return { chip: 'closed', label: status.charAt(0).toUpperCase() + status.slice(1) };
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
        .select('id, business_name, trade, audience, plan, status, stripe_payouts_enabled, trial_ends_at')
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
                <Link href="/services/join" className="inline-flex mt-6 items-center gap-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl px-5 py-3">
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

    const offPlatform = provider.plan === 'subscription';
    const live = provider.stripe_payouts_enabled === true;

    // Coverage area label — the first circle is enough for the header.
    const { data: areas } = await admin
        .from('service_areas')
        .select('label')
        .eq('provider_id', provider.id)
        .order('created_at', { ascending: true });
    const areaLabel = (areas && areas[0] && areas[0].label) || '';

    // The badge: a verified registration wears its scheme's name (Gas Safe,
    // OFTEC, NICEIC…); an approved provider without one is simply Approved.
    const { data: regs } = await admin
        .from('service_provider_registrations')
        .select('scheme, number, verified_at, verified_number, expires_at')
        .eq('provider_id', provider.id);
    const verifiedReg = (regs || []).find((r: any) => registrationVerified(r));
    const badge = verifiedReg ? schemeLabel(verifiedReg.scheme) : 'Approved';

    // Everything that has arrived for this provider.
    const { data: enquiryRows } = await admin
        .from('service_enquiries')
        .select('id, status, summary, area_key, urgency, preferred_date, window_from, window_to, host_name, host_phone, sent_at, expires_at')
        .eq('provider_id', provider.id)
        .order('sent_at', { ascending: false });

    const today = todayKey();

    const enquiries: DashboardEnquiry[] = (enquiryRows || [])
        // Withdrawn requests are gone from the host's side; don't surface them.
        .filter((e: any) => e.status !== 'withdrawn')
        .map((e: any) => {
            const { chip, label } = chipFor(e.status);
            const asked = requestedWhen(e);
            return {
                id: e.id,
                chip,
                chipLabel: label,
                title: e.summary,
                // "Asked for …", never "booked for" — the wording the emails
                // and the host's list already hold. requestedWhen owns it.
                askedFor: asked,
                sub: prettyArea(e.area_key),
                contactName: e.host_name || null,
                contactPhone: e.host_phone || null,
                when: chip === 'new' ? null : shortDay(e.sent_at),
                replyBy: chip === 'new' ? replyByLabel(e.expires_at) : null,
                answerHref: null,
            };
        });

    const toAnswer = enquiries.filter((e) => e.chip === 'new').length;

    // Upcoming work (host trades): accepted requests whose day is still ahead.
    // Each one reads "Asked for", not a committed slot.
    const upcoming: DashboardUpcoming[] = (enquiryRows || [])
        .filter((e: any) => e.status === 'accepted' && e.preferred_date && e.preferred_date >= today)
        .sort((a: any, b: any) => String(a.preferred_date).localeCompare(String(b.preferred_date)))
        .map((e: any) => {
            const d = new Date(String(e.preferred_date) + 'T12:00:00Z');
            const window = (requestedWhen(e) || 'any time that day').replace(/^Asked for [^,]+,\s*/, '');
            return {
                id: e.id,
                day: d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: LONDON }),
                month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: LONDON }),
                title: `${e.summary}${e.area_key ? ' · ' + prettyArea(e.area_key) : ''}`,
                window,
                contactName: e.host_name || null,
            };
        });

    return (
        <ProviderDashboard
            businessName={provider.business_name}
            tradeName={tradeLabel(provider.trade)}
            areaLabel={areaLabel}
            badge={badge}
            offPlatform={offPlatform}
            live={live}
            editHref={`/services/join?trade=${provider.trade}`}
            enquiries={enquiries}
            upcoming={upcoming}
            toAnswer={toAnswer}
            nextPayoutLabel={null}
        />
    );
}

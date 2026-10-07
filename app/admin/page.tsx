import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { adminPendingFor, EMPTY_ADMIN_PENDING } from '@/lib/badgeCounts';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// The three review queues, each pointing at the page and section that clears it.
// Shown as a "Needs review" row at the top so the owner sees, from the page they
// land on, exactly what is waiting and where to go for it.
const reviewQueues: { key: 'holidayLets' | 'experiences' | 'trades'; href: string; title: string; blurb: string }[] = [
    { key: 'holidayLets', href: '/admin/listings', title: 'Holiday lets', blurb: 'Property listings waiting for approval.' },
    { key: 'experiences', href: '/admin/providers#experiences', title: 'Experiences', blurb: 'Guest experiences waiting for review.' },
    { key: 'trades', href: '/admin/providers#trades', title: 'Trades', blurb: 'Tradespeople and businesses waiting for review.' },
];

const tools = [
    {
        href: '/admin/listings',
        title: 'All listings',
        blurb: 'Every property on the site. Take one down, or put it back.',
    },
    {
        href: '/admin/commission',
        title: 'Commission rates',
        blurb: 'What each property is charged. Blank means the standard rate.',
    },
    {
        href: '/admin/earnings',
        title: 'Earnings by property',
        blurb: 'Every property ranked by what it has taken this year.',
    },
    {
        href: '/admin/traffic',
        title: 'Traffic and growth',
        blurb: 'Month by month: sign-ups, listings, bookings, nights, value, commission and cancellations.',
    },
    {
        href: '/admin/payouts',
        title: 'Payouts',
        blurb: 'What each host is owed, and what has already been sent.',
    },
    {
        href: '/admin/held-payouts',
        title: 'Money held for providers',
        blurb: 'Experience providers who are live but haven\u2019t set up payouts, and how much we\u2019re holding for each.',
    },
    {
        href: '/admin/experience-orders',
        title: 'Experience orders',
        blurb: 'Paid experience bookings. Refund all or part of one.',
    },
    {
        href: '/admin/disputes',
        title: 'Chargebacks',
        blurb: 'Disputes raised by guests\u2019 banks, and what evidence to send.',
    },
    {
        href: '/admin/resolutions',
        title: 'Money disputes',
        blurb: 'Escalated money requests \u2014 declined or ignored \u2014 waiting on a decision.',
    },
    {
        href: '/admin/listing-reports',
        title: 'Listing reports',
        blurb: 'What guests and visitors have flagged about a listing. Never shared with the host.',
    },
    {
        // This page existed and was linked from nowhere. You could only reach
        // it by knowing the URL, which for the one screen that holds people
        // waiting on you is the same as it not being there.
        href: '/admin/providers',
        title: 'Tradesmen and businesses',
        blurb: 'Applications to review, and the ones still waiting on the applicant.',
    },
    {
        href: '/admin/accounts',
        title: 'Deactivated accounts',
        blurb: 'People who switched their account off. Reactivate one when they ask.',
    },
    {
        href: '/admin/reviews',
        title: 'Reviews',
        blurb: 'The latest reviews of stays and experiences. Take one down if it needs it, or put it back.',
    },
    {
        href: '/admin/errors',
        title: 'Errors',
        blurb: 'Anything that broke, whether or not anyone told us.',
    },
    {
        href: '/admin/skills',
        title: 'Skills',
        blurb: 'Tidy up the tags tradesmen write for themselves, before one job becomes four words.',
    },
];

export default async function AdminHome() {
    // Every owner page checks for itself. Hiding the link is tidiness, not
    // security — this is what actually keeps people out.
    const authUser = await requireAdmin();

    // A number on the tile, so the count is visible from the page you land on
    // rather than from the one you had to remember. Counted rather than
    // fetched: this is a badge, not a list.
    //
    // Read failures are swallowed on purpose. A tile without a number is a
    // tile; a whole owner-tools page that will not render because a count
    // query failed is worse than not knowing.
    const badges: Record<string, number> = {};
    // The three review queues, the same numbers as the burger dot and the
    // "Owner tools" count (one helper, so they can't drift).
    let pending = { ...EMPTY_ADMIN_PENDING };

    try {
        const admin = adminClient();

        pending = await adminPendingFor(authUser.id);

        const { count: openReports } = await admin
            .from('listing_reports')
            .select('id', { count: 'exact', head: true })
            .is('closed_at', null);
        badges['/admin/listing-reports'] = Number(openReports || 0);
    } catch (err) {
        // See above.
    }

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Owner tools</h1>
            <p className="text-sm text-slate-500 mb-8">
                Only you and your business partner can see these pages.
            </p>

            {/* NEEDS REVIEW — the three queues waiting on you, each a tap from
                the page and section that clears it. The number drops as each item
                is approved or declined (it's counted live, never stored). */}
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Needs review</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
                {reviewQueues.map((q) => {
                    const n = pending[q.key];
                    return (
                        <Link
                            key={q.key}
                            href={q.href}
                            className={'block rounded-2xl border p-4 transition hover:border-slate-900 '
                                + (n > 0 ? 'border-emerald-300 bg-emerald-50/40' : '')}
                        >
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-900">{q.title}</span>
                                {n > 0 && (
                                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-700 text-white">
                                        {n}
                                    </span>
                                )}
                            </div>
                            <div className="text-sm text-slate-500 mt-0.5">
                                {n > 0 ? q.blurb : 'Nothing waiting.'}
                            </div>
                        </Link>
                    );
                })}
            </div>

            <div className="space-y-3">
                {tools.map((t) => (
                    <Link
                        key={t.href}
                        href={t.href}
                        className="block border rounded-2xl p-5 hover:border-slate-900 transition"
                    >
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                            {t.title}
                            {badges[t.href] > 0 && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-700 text-white">
                                    {badges[t.href]}
                                </span>
                            )}
                        </div>
                        <div className="text-sm text-slate-500 mt-0.5">{t.blurb}</div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

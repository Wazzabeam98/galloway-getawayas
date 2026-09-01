import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

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
        href: '/admin/payouts',
        title: 'Payouts',
        blurb: 'What each host is owed, and what has already been sent.',
    },
    {
        href: '/admin/disputes',
        title: 'Chargebacks',
        blurb: 'Disputes raised by guests\u2019 banks, and what evidence to send.',
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
    await requireAdmin();

    // A number on the tile, so the count is visible from the page you land on
    // rather than from the one you had to remember. Counted rather than
    // fetched: this is a badge, not a list.
    //
    // Read failures are swallowed on purpose. A tile without a number is a
    // tile; a whole owner-tools page that will not render because a count
    // query failed is worse than not knowing.
    const badges: Record<string, number> = {};

    try {
        const admin = adminClient();

        const [{ count: toReview }, { count: toChase }] = await Promise.all([
            admin
                .from('service_providers')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'pending_review'),
            admin
                .from('service_applications')
                .select('id', { count: 'exact', head: true })
                .is('claimed_at', null),
        ]);

        badges['/admin/providers'] = Number(toReview || 0) + Number(toChase || 0);
    } catch (err) {
        // See above.
    }

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Owner tools</h1>
            <p className="text-sm text-slate-500 mb-8">
                Only you and your business partner can see these pages.
            </p>

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

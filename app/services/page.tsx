import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
    TRADES,
    HOST_TRADES,
    canBeEnquiredAbout,
    comingSoonNote,
} from '@/lib/serviceProviders';

export const metadata = {
    title: 'Find a tradesman | Galloway Getaways',
    description:
        'Electricians, joiners, plumbers, roofers, painters, handymen and window cleaners '
        + 'covering Dumfries & Galloway. Browse who covers your property and ask one of them.',
};

// The host-facing shop.
//
// THIS URL USED TO BE SOMETHING ELSE
//
// A hand-built page over the flat `services` catalogue and `service_requests`,
// with three rows on production behind it. It was Liam's own manual flow and
// this replaces it. The table and its rows are untouched — retiring a page is
// not a reason to delete somebody's data — but the URL is now this.
//
// BROWSE, NOT MATCH
//
// A host picks a trade, sees who covers them, reads the prices where a
// provider has published them, and asks ONE person. Nothing scores anybody and
// nothing fans out. What the platform sells is the introduction.
//
// ALL TEN TRADES ARE ON THIS PAGE, INCLUDING THE THREE THAT DO NOTHING
//
// Cleaning and waste are not enquired about — they take a commission at
// acceptance, which needs a total, which needs a booking. Gardening is waiting
// on a plot field that no form writes yet. All three could simply have been
// left off, and that is the version to avoid: a host who came here for a
// cleaner and found no mention of cleaning concludes the site is broken rather
// than that the feature is late. So they are listed, and they say so.
export default function ServicesPage() {
    const trades = TRADES.filter(
        (t) => (HOST_TRADES as readonly string[]).indexOf(t.key) !== -1
    );

    const live = trades.filter((t) => canBeEnquiredAbout(t.key));
    const soon = trades.filter((t) => !canBeEnquiredAbout(t.key));

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                Find a tradesman
            </h1>
            <p className="text-slate-600 mt-3">
                Local businesses covering your property. You see who they are and what they charge
                before you ask, and you ask one of them — not five.
            </p>
            <p className="text-sm text-slate-500 mt-3 mb-10">
                We take nothing from the job. Whatever you agree is between you and them.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
                {live.map((trade) => (
                    <Link
                        key={trade.key}
                        href={'/services/' + trade.key}
                        className="group rounded-2xl border border-slate-300 p-5 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                    >
                        <h2 className="font-bold text-slate-900">{trade.label}</h2>
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 mt-3">
                            See who covers you
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                        </span>
                    </Link>
                ))}
            </div>

            {soon.length > 0 && (
                <div className="mt-10">
                    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                        Not yet
                    </h2>
                    <div className="grid sm:grid-cols-2 gap-3 mt-3">
                        {soon.map((trade) => (
                            <div
                                key={trade.key}
                                className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                            >
                                <h3 className="font-bold text-slate-500">{trade.label}</h3>
                                <p className="text-sm text-slate-500 mt-2">
                                    {comingSoonNote(trade.key)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <p className="text-sm text-slate-500 mt-12">
                Already asked somebody?{' '}
                <Link
                    href="/dashboard/enquiries"
                    className="text-emerald-700 font-semibold underline hover:text-emerald-800"
                >
                    See your enquiries
                </Link>
                .
            </p>
        </div>
    );
}

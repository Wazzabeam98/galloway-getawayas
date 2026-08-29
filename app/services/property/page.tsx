import Link from 'next/link';
import { TradeTile, TradeTileGrid } from '@/components/services/TradeTiles';
import {
    TRADES,
    HOST_TRADES,
    canBeEnquiredAbout,
    comingSoonNote,
} from '@/lib/serviceProviders';

export const metadata = {
    title: 'For your property',
    description:
        'Electricians, joiners, plumbers, roofers, painters, handymen and window cleaners '
        + 'covering Dumfries & Galloway. Browse who covers your property and ask one of them.',
    alternates: { canonical: '/services/property' },
};

// The owner's half of the services idea — hiring local tradespeople for their
// own property. It used to live at /services; that URL is now the hub that
// names both halves (owners hire, guests book), and this is one branch of it.
// The guest half is explained on the hub and shown on a guest's trip page, so
// this page no longer needs its own signpost across.
//
// BROWSE, NOT MATCH. A host picks a trade, sees who covers them, reads prices
// where published, and asks ONE person. Nothing scores anybody. What the
// platform sells is the introduction.
//
// ALL TEN HOST TRADES ARE LISTED, INCLUDING THE THREE THAT DO NOTHING — a host
// who came for a cleaner and found no mention of cleaning concludes the site
// is broken, not that the feature is late. So they are listed, and say so.
export default function PropertyServicesPage() {
    const trades = TRADES.filter(
        (t) => (HOST_TRADES as readonly string[]).indexOf(t.key) !== -1
    );

    const live = trades.filter((t) => canBeEnquiredAbout(t.key));
    const soon = trades.filter((t) => !canBeEnquiredAbout(t.key));

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <Link href="/services" className="text-sm text-slate-500 hover:text-slate-700">
                ← Services
            </Link>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mt-3">
                For your property
            </h1>
            <p className="text-slate-600 mt-3">
                Local tradespeople covering your property — cleaning, gardening, window cleaning,
                maintenance and repairs. You see who they are and what they charge before you ask,
                and you ask one of them — not five.
            </p>
            <p className="text-sm text-slate-500 mt-3 mb-10">
                We take nothing from the job. Whatever you agree is between you and them.
            </p>

            {/* Kept here as well as on the hub: the footer links straight to
                this page, so a host who arrives directly still needs the pointer
                across to the guest half. */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-10 text-sm text-slate-600">
                Looking for what your{' '}
                <span className="font-medium text-slate-800">guests</span> can book during a stay —
                a private chef, a welcome hamper, pet care?{' '}
                <Link href="/trips" className="text-emerald-700 font-semibold underline hover:text-emerald-800">
                    Those are offered to guests on their trip page.
                </Link>
            </div>

            <TradeTileGrid>
                {live.map((trade) => (
                    <TradeTile
                        key={trade.key}
                        tradeKey={trade.key}
                        label={trade.label}
                        href={'/services/' + trade.key}
                    />
                ))}
            </TradeTileGrid>

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

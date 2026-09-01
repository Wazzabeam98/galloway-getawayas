import Link from 'next/link';
import { Home, Sparkles, Store, ArrowRight } from 'lucide-react';

export const metadata = {
    title: 'Services',
    description:
        'Local services and experiences around a Galloway Getaways stay — tradespeople for owners, '
        + 'experiences for guests, and a way in for local businesses.',
    alternates: { canonical: '/services' },
};

// The shared parent the two halves lacked.
//
// "Services" used to mean only the owner's tradesman shop, which is why guest
// experiences — the same idea from the other end — had no relationship to it
// on the site, and people came here looking for them and left confused. This
// page names the whole thing and branches by who you are: an owner hiring for
// their property, a guest booking during a stay, or a business selling to
// either. The tradesman shop is now one branch of it, at /services/property;
// its trade pages keep their /services/<trade> URLs.
export default function ServicesHub() {
    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                Services
            </h1>
            <p className="text-slate-600 mt-3 mb-10">
                Local businesses around a Galloway stay — the people an owner hires for their
                cottage, and the experiences a guest books while they’re here. Whichever you are:
            </p>

            <div className="space-y-4">
                {/* Owners */}
                <Link
                    href="/services/property"
                    className="group block rounded-2xl border border-slate-300 p-6 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                >
                    <Home className="w-8 h-8 text-emerald-700 mb-4" strokeWidth={1.5} />
                    <h2 className="font-bold text-slate-900 text-lg">For your property</h2>
                    <p className="text-sm text-slate-600 mt-2">
                        Own a cottage? Hire local tradespeople for it — cleaning, gardening, window
                        cleaning, maintenance and repairs. See who covers you and ask one of them.
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 mt-4">
                        Browse tradespeople
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                    </span>
                </Link>

                {/* Guests */}
                <Link
                    href="/trips"
                    className="group block rounded-2xl border border-slate-300 p-6 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                >
                    <Sparkles className="w-8 h-8 text-emerald-700 mb-4" strokeWidth={1.5} />
                    <h2 className="font-bold text-slate-900 text-lg">For your stay</h2>
                    <p className="text-sm text-slate-600 mt-2">
                        Staying with us? Local experiences you can book while you’re here — a private
                        chef, a welcome hamper, a cake. They appear on your trip page once you’ve
                        booked a cottage, matched to where you’re staying and your dates.
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 mt-4">
                        Go to your trips
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                    </span>
                </Link>

                {/* Businesses */}
                <Link
                    href="/business"
                    className="group block rounded-2xl border border-slate-300 p-6 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                >
                    <Store className="w-8 h-8 text-emerald-700 mb-4" strokeWidth={1.5} />
                    <h2 className="font-bold text-slate-900 text-lg">Run a local business</h2>
                    <p className="text-sm text-slate-600 mt-2">
                        Sell to owners as a tradesperson, or to guests as an experience. You keep your
                        own prices; we put you in front of the right people.
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 mt-4">
                        Set up a business
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                    </span>
                </Link>
            </div>
        </div>
    );
}

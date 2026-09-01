import Link from 'next/link';
import { Sparkles, ChefHat, ArrowRight } from 'lucide-react';
import { tradesFor } from '@/lib/serviceProviders';

export const metadata = {
    // The root layout appends ' | Galloway Getaways' to every page title, so
    // naming it here again put it in the tab twice. Same fix as app/services.
    title: 'Set up a business',
    description:
        'For local tradespeople and businesses in Dumfries & Galloway — cleaning, gardening, '
        + 'maintenance, and experiences sold to guests staying nearby.',
    alternates: { canonical: '/business' },
};

// The way in for tradespeople and local businesses.
//
// Linked from the footer rather than the navbar: the navbar is for guests and
// hosts, and a fourth kind of person in it would crowd the two that matter on
// every page.
//
// The line about letting a property is the whole point of this page existing.
// "Set up a business" reads, to somebody with a cottage, exactly like the
// thing they came to do — and sending them into a cleaner's sign-up would be
// nobody's fault but ours.
export default function BusinessPage() {
    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                Set up a business
            </h1>
            <p className="text-slate-600 mt-3">
                For local tradespeople and businesses across Dumfries &amp; Galloway. You keep your own
                customers and your own prices; we put you in front of the people who need you.
            </p>
            <p className="text-sm text-slate-500 mt-3 mb-10">
                Wanting to let out a cottage instead?{' '}
                <Link href="/addhome" className="text-emerald-700 font-semibold underline hover:text-emerald-800">
                    List your property
                </Link>{' '}
                — that is a different thing and this is not it.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
                <Link
                    href="/services/join"
                    className="group rounded-2xl border border-slate-300 p-6 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                >
                    <Sparkles className="w-8 h-8 text-emerald-700 mb-4" strokeWidth={1.5} />
                    <h2 className="font-bold text-slate-900 text-lg">Work for property owners</h2>
                    <p className="text-sm text-slate-600 mt-2">
                        Changeover cleaning, waste, gardening, maintenance and window cleaning. Owners
                        find you by the areas you cover and ask you for work.
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 mt-4">
                        Start
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                    </span>
                </Link>

                <div className="rounded-2xl border border-slate-300 p-6">
                    <ChefHat className="w-8 h-8 text-emerald-700 mb-4" strokeWidth={1.5} />
                    <h2 className="font-bold text-slate-900 text-lg">Sell to guests</h2>
                    <p className="text-sm text-slate-600 mt-2">
                        Private chefs, cakes, hampers and more — bought by people staying in the
                        cottages rather than by the people who own them.
                    </p>

                    {/* Said plainly, not buried: signing up is not going live.
                        A guest cannot see you until you have been approved and
                        have connected Stripe for payouts — the same two steps a
                        cleaner or a host goes through. */}
                    <p className="text-sm text-slate-500 mt-3">
                        You apply, we check your business, and you connect Stripe so we can pay you.
                        A guest can book you once you are approved and connected — not the moment you
                        sign up.
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                        {tradesFor('guest').map((t) => (
                            <Link
                                key={t.key}
                                href={'/services/join?trade=' + t.key}
                                className="group flex items-center justify-between rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                            >
                                {t.label}
                                <ArrowRight className="w-4 h-4 text-emerald-700 group-hover:translate-x-0.5 transition" />
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

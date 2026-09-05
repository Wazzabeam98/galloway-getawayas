import Link from 'next/link';
import { Sparkles, ChefHat, ArrowRight, Check } from 'lucide-react';

export const metadata = {
    // The root layout appends ' | Galloway Getaways' to every page title, so
    // naming it here again put it in the tab twice. Same fix as app/services.
    title: 'Set up a business',
    description:
        'For local tradespeople and businesses in Dumfries & Galloway — cleaning, gardening, '
        + 'maintenance, and experiences sold to guests staying nearby.',
    alternates: { canonical: '/business' },
};

// The way in for tradespeople and local businesses — the front door to both
// sign-ups, so it is worth looking like something rather than two bordered
// boxes. Two cards, one decision: do property owners hire you, or do the guests
// staying nearby book you?
//
// The line about letting a property is the whole point of this page existing.
// "Set up a business" reads, to somebody with a cottage, exactly like the
// thing they came to do — and sending them into a cleaner's sign-up would be
// nobody's fault but ours.

// One selling point, ticked. Kept small so the card leads with its heading.
function Point({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2 text-sm text-slate-600">
            <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" strokeWidth={2.5} />
            <span>{children}</span>
        </li>
    );
}

export default function BusinessPage() {
    return (
        <div className="relative isolate overflow-hidden">
            {/* A soft wash behind the hero so the cards sit on something, not on
                bare white — the same emerald the brand uses, barely there. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-emerald-50 to-transparent"
            />

            <div className="mx-auto max-w-4xl px-4 sm:px-6 py-14 pb-24">
                <div className="max-w-2xl">
                    <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-600/20">
                        Galloway Getaways for business
                    </span>
                    <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
                        Set up a business
                    </h1>
                    <p className="mt-4 text-lg leading-relaxed text-slate-600">
                        For local tradespeople and businesses across Dumfries &amp; Galloway. You keep your
                        own customers and your own prices; we put you in front of the people who need you.
                    </p>
                    <p className="mt-3 text-sm text-slate-500">
                        Wanting to let out a cottage instead?{' '}
                        <Link href="/addhome" className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800">
                            List your property
                        </Link>{' '}
                        — that is a different thing and this is not it.
                    </p>
                </div>

                <div className="mt-10 grid items-stretch gap-5 sm:grid-cols-2">
                    {/* Tradesperson — a local business getting leads from cottages, not a host's staff. */}
                    <Link
                        href="/services/join"
                        className="group relative flex flex-col rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-600/15">
                            <Sparkles className="h-7 w-7 text-emerald-700" strokeWidth={1.75} />
                        </span>
                        <h2 className="mt-5 text-xl font-bold text-slate-900">Get work from holiday lets</h2>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                            Changeover cleaning, waste, gardening, maintenance and window cleaning.
                            The jobs come to you — owners near you find you by the areas you cover and get in touch.
                        </p>
                        <ul className="mt-5 space-y-2">
                            <Point>Listed by the trades and areas you cover</Point>
                            <Point>Owners message you directly with the job</Point>
                            <Point>Your own prices, your own customers</Point>
                        </ul>
                        <span className="mt-auto pt-6 inline-flex items-center gap-2 self-start rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition group-hover:bg-emerald-800">
                            Get started
                            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                        </span>
                    </Link>

                    {/* Guest experience — booked by the guests staying nearby. */}
                    <Link
                        href="/services/join?trade=guest"
                        className="group relative flex flex-col rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-600/15">
                            <ChefHat className="h-7 w-7 text-emerald-700" strokeWidth={1.75} />
                        </span>
                        <h2 className="mt-5 text-xl font-bold text-slate-900">Sell guest experiences</h2>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                            A private chef, a cake, a welcome hamper, a wild-swimming guide, a whisky
                            tasting — anything a guest would book for their stay. Bought by the people
                            staying in the cottages, not by the owners.
                        </p>
                        <ul className="mt-5 space-y-2">
                            <Point>Shown to guests booked into cottages near you</Point>
                            <Point>Take payment through the site, paid out by Stripe</Point>
                            <Point>You set what you offer and what it costs</Point>
                        </ul>

                        {/* Said plainly, not buried: signing up is not going live. A
                            guest cannot see you until you are approved and have
                            connected Stripe — the same two steps a host goes through. */}
                        <p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-500">
                            You describe your business and set your prices; we check it and give it a
                            category; you connect Stripe so we can pay you. A guest can book you once
                            you are approved and connected — not the moment you sign up.
                        </p>

                        <span className="mt-auto pt-6 inline-flex items-center gap-2 self-start rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition group-hover:bg-emerald-800">
                            Get started
                            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                        </span>
                    </Link>
                </div>
            </div>
        </div>
    );
}

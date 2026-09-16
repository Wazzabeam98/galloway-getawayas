import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// A coming-soon strip at the very top of the HOMEPAGE only (rendered from
// app/page.tsx, not the global navbar): the site takes cottage bookings today,
// so "Coming soon" must never appear on a listing page or at checkout where it
// would read as though the whole site were shut. Here it is unambiguously about
// hosts and trades signing up. Brand emerald so it reads as the platform's own
// voice; centred, sitting above the hero.
export default function ComingSoonBanner() {
    return (
        <div className="w-full bg-emerald-700 text-white">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 px-4 py-3 text-center">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
                    Coming soon
                </span>
                <p className="text-sm font-semibold leading-snug sm:text-[0.9375rem]">
                    Own a holiday let, or offer an experience or a service in Dumfries &amp; Galloway?
                </p>
                <Link
                    href="/register-interest"
                    className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                    Register your interest
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </div>
    );
}

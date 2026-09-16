import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// A coming-soon strip at the very top of the homepage: we are opening to hosts
// and trades across Dumfries & Galloway, and the one action is to register
// interest. Brand emerald so it reads as the platform's own voice, not a
// bolted-on notice. Full-width, sits above the hero.
export default function ComingSoonBanner() {
    return (
        <div className="w-full bg-emerald-700 text-white">
            <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-3 text-center sm:flex-row sm:justify-center sm:gap-4 sm:py-2.5">
                <p className="text-sm leading-snug sm:text-[0.9375rem]">
                    <span className="font-semibold">Opening soon for hosts &amp; trades.</span>{' '}
                    <span className="text-emerald-50">Listing a holiday let, a guest experience or a service in Dumfries &amp; Galloway?</span>
                </p>
                <Link
                    href="/register-interest"
                    className="inline-flex flex-none items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                    Register your interest
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </div>
    );
}

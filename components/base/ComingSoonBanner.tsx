import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// A slim announcement bar at the top of the HOMEPAGE only (rendered from
// app/page.tsx, never the global navbar): the site takes cottage bookings today,
// so this secondary "hosts & trades, coming soon" message must not eat vertical
// space above the hero, nor compete with the product. One row — a "Coming soon"
// tag, the one question, and the button inline on the right — on a pale ground
// with dark text, the button the only strong colour. Text wraps on the narrowest
// phones; the button stays on the right at every width.
export default function ComingSoonBanner() {
    return (
        <div className="w-full border-b border-emerald-100 bg-emerald-50">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:gap-4">
                <p className="min-w-0 text-sm leading-snug text-emerald-950">
                    {/* Desktop: the "Coming soon" tag plus the full question. */}
                    <span className="mr-2 hidden whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-emerald-700 sm:inline-block">
                        Coming soon
                    </span>
                    <span className="hidden align-middle sm:inline">
                        Own a holiday let, or offer an experience or a service in Dumfries &amp; Galloway?
                    </span>
                    {/* Mobile: a short phrase that carries "coming soon" itself, so it
                        stays on one line beside the button. */}
                    <span className="font-semibold sm:hidden">Hosts &amp; trades &mdash; coming soon</span>
                </p>
                <Link
                    href="/register-interest"
                    className="inline-flex flex-none items-center gap-1.5 rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                >
                    <span className="hidden sm:inline">Register your interest</span>
                    <span className="sm:hidden">Register</span>
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </div>
    );
}

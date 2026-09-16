import Link from 'next/link';

// A slim announcement bar at the top of the HOMEPAGE only (rendered from
// app/page.tsx, never the global navbar): the site takes cottage bookings today,
// so this "hosts & trades, coming soon" message must not eat vertical space
// above the hero, nor compete with the product. Pale ground, dark text, the
// button the only strong colour.
//
// Desktop: a three-column grid — an empty 1fr, the centred text block, then the
// button pinned right in the matching 1fr — so the text sits centred across the
// bar without the button crowding or overlapping it. Mobile: a simple row with a
// short phrase on the left and the button on the right.
export default function ComingSoonBanner() {
    return (
        <div className="w-full border-b border-emerald-100 bg-emerald-50">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
                <p className="min-w-0 text-sm leading-snug text-emerald-950 sm:col-start-2 sm:text-center">
                    {/* Desktop: a prominent COMING SOON tag plus the full question. */}
                    <span className="mr-2 hidden whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold uppercase tracking-wide text-emerald-700 sm:inline-block">
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
                    className="inline-flex flex-none items-center rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 sm:col-start-3 sm:justify-self-end"
                >
                    <span className="hidden sm:inline">Register your interest</span>
                    <span className="sm:hidden">Register</span>
                </Link>
            </div>
        </div>
    );
}

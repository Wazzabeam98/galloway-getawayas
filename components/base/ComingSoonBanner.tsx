import Link from 'next/link';

// A slim announcement bar at the top of the HOMEPAGE only (rendered from
// app/page.tsx, never the global navbar): the site takes cottage bookings today,
// so this "hosts & trades, coming soon" message must not eat vertical space
// above the hero, nor compete with the product. Pale ground, dark text, the
// button the only strong colour.
//
// Desktop: a three-column grid whose outer columns are equal (1fr each), so the
// question in the middle sits page-centred. COMING SOON is pinned to the LEFT
// column and the button to the RIGHT. The bar shares the navbar's width and side
// gutters (max-w-7xl, px-6 / md:px-10) so COMING SOON lines up under the Galloway
// Getaways logo and the button under the account controls. Mobile: a simple row
// with a short phrase on the left and the button on the right (the tag is hidden;
// the short phrase carries "coming soon" itself).
//
// TO NUDGE SPACING: the side gutters are `px-6` / `md:px-10` on the inner div
// below; COMING SOON's exact position is `sm:justify-self-start` on its span (add
// e.g. `sm:ml-1`); the button is `sm:justify-self-end` on the Link. Vertical
// height is `py-2` on the inner div.
export default function ComingSoonBanner() {
    return (
        <div className="w-full border-y border-emerald-200 bg-emerald-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4 md:px-10">
                {/* Desktop only: the COMING SOON tag, left, under the logo. */}
                <span className="hidden whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold uppercase tracking-wide text-emerald-700 sm:col-start-1 sm:inline-block sm:justify-self-start">
                    Coming soon
                </span>
                {/* Same full question on every size — on a phone it wraps to two
                    lines beside the button, which is fine; the desktop tag carries
                    "coming soon" and the mobile short-form is gone. */}
                <p className="min-w-0 align-middle text-sm leading-snug text-emerald-950 sm:col-start-2 sm:text-center">
                    Own a holiday let, offer an experience or a service in Dumfries &amp; Galloway?
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

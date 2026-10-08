import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace } from '@/lib/experiencesData';
import ProviderCard from '@/components/marketplace/ProviderCard';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

// Without this the page inherited the root layout's default title and
// description — so this public marketplace went out to Google wearing the home
// page's "Holiday Cottages & Accommodation" title and no canonical of its own.
// Static, because the page's own copy (the h1, the kicker) is fixed; only the
// providers below it change. Relative canonical/url resolve against
// metadataBase in app/layout.tsx, as the listing page's canonical does.
export const metadata: Metadata = {
    title: 'Experiences & Things to Do in Dumfries & Galloway',
    description:
        'Book local experiences across Dumfries & Galloway — chefs, bakers, saunas, guides and classes. Booked and paid securely through Galloway Getaways, with no booking fee.',
    alternates: { canonical: '/experiences/browse' },
    openGraph: {
        type: 'website',
        locale: 'en_GB',
        url: '/experiences/browse',
        siteName: 'Galloway Getaways',
        title: 'Experiences & Things to Do in Dumfries & Galloway',
        description:
            'Local experiences across Dumfries & Galloway — chefs, bakers, saunas, guides and classes, booked direct.',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Experiences & Things to Do in Dumfries & Galloway',
        description:
            'Local experiences across Dumfries & Galloway — chefs, bakers, saunas, guides and classes.',
    },
};

// The PUBLIC experiences marketplace — anyone can browse this without logging in.
// No booking, no stay: the against-a-cottage marketplace lives at
// /experiences/[bookingId] and this is its bookingless twin. Signing in is only
// needed to book (prompted on the listing), never to look.
export default async function BrowseExperiencesPage() {
    const admin = adminClient();
    const mp = await loadPublicMarketplace(admin, guestExperiencesOpen());

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
                <header className="mb-8 sm:mb-12 max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                        Things to do in Dumfries &amp; Galloway
                    </p>
                    <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                        Local experiences to book
                    </h1>
                    <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                        Chefs, bakers, saunas, guides and classes across the region — booked and paid
                        securely through Galloway Getaways. Browse freely; you sign in to book.
                    </p>
                </header>

                {mp.open === false ? (
                    <Empty title="Coming soon"
                        body="We’re lining up chefs, bakers, saunas and guides across Dumfries & Galloway. Check back soon." />
                ) : mp.providers.length === 0 ? (
                    <Empty title="Nothing listed yet"
                        body="It’s a new part of the site and filling in fast — check back soon." />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                        {mp.providers.map((p) => (
                            <ProviderCard key={p.id} p={p} href={`/experiences/browse/${p.id}`} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Empty({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{body}</p>
        </div>
    );
}

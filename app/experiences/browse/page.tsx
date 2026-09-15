import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace } from '@/lib/experiencesData';
import ProviderCard from '@/components/marketplace/ProviderCard';

export const dynamic = 'force-dynamic';

// The PUBLIC experiences marketplace — anyone can browse this without logging in.
// No booking, no stay: the against-a-cottage marketplace lives at
// /experiences/[bookingId] and this is its bookingless twin. Signing in is only
// needed to book (prompted on the listing), never to look.
export default async function BrowseExperiencesPage() {
    const admin = adminClient();
    const mp = await loadPublicMarketplace(admin, guestExperiencesOpen());
    // Only show experiences that have a real photo — never a bare gradient card.
    const providers = mp.providers.filter((p) => !!p.hero);

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
                ) : providers.length === 0 ? (
                    <Empty title="Nothing listed yet"
                        body="It’s a new part of the site and filling in fast — check back soon." />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                        {providers.map((p) => (
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

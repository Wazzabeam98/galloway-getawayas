import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace } from '@/lib/experiencesData';
import ProviderCard from '@/components/marketplace/ProviderCard';

// Experiences on the home page, alongside the properties, so a visitor who lands
// on the site sees everything on offer without having to know the /experiences
// URL. Below the property grid on purpose — the cottages are still the reason
// most people are here — but above the editorial, so it reads as a second thing
// to book rather than a footnote.
//
// Self-gating: renders nothing while GUEST_EXPERIENCES_OPEN is unset (the whole
// feature is dormant until then), and nothing when there are no live providers,
// so the home page never advertises an empty shelf. Public — no auth needed to
// see or to reach the browse page. Cards carry no rating: master's ProviderCard
// deliberately shows the "Verified business" badge, not stars, until there are
// reviews to mean one.
const MAX_ON_HOME = 8;

export default async function HomeExperiences() {
    if (!guestExperiencesOpen()) return null;

    const admin = adminClient();
    const mp = await loadPublicMarketplace(admin, true);
    if (!mp.open || mp.providers.length === 0) return null;

    // Only ones with a real photo — a card on a bare gradient block reads as
    // unfinished, so it is not shown at all.
    const withPhoto = mp.providers.filter((p) => !!p.hero);
    if (withPhoto.length === 0) return null;
    const shown = withPhoto.slice(0, MAX_ON_HOME);

    return (
        <section className="mt-16 pt-10 border-t border-stone-200">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        Experiences to book
                    </h2>
                    <p className="text-stone-600 text-sm md:text-base mt-1">
                        Local chefs, bakers, saunas and guides across Dumfries &amp; Galloway — add
                        one to your stay, or book it on its own.
                    </p>
                </div>
                <Link
                    href="/experiences/browse"
                    className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4"
                >
                    See all experiences
                </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                {shown.map((p) => (
                    <ProviderCard key={p.id} p={p} href={`/experiences/browse/${p.id}`} />
                ))}
            </div>
        </section>
    );
}

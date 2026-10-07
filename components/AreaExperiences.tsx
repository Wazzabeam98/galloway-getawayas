import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace } from '@/lib/experiencesData';
import { servesTown } from '@/lib/experienceTowns';
import { ExperienceCard } from '@/components/HomeExperiences';

// Experiences for one PLACE — a town page, and a property page's "Experiences
// nearby" — rather than the whole region (HomeExperiences shows everything).
//
// One rule for both, lib/experienceTowns: a provider covering all of Dumfries &
// Galloway is on every town; one covering certain regions only on those regions'
// towns; one based at a place on that town (not one who only travels). A
// property page passes its own town's area (or, in a village, the nearest
// town's — experienceAreaForListing). The old town-centre-and-radius test is
// gone: a guest provider's coverage is named regions, which it never matched.
//
// Self-gating: nothing while GUEST_EXPERIENCES_OPEN is unset, nothing when no
// live provider with a photo matches — a page never advertises an empty shelf.
// Every match is shown, on the property-style card the holiday lets use.
export default async function AreaExperiences({
    heading = 'Experiences nearby',
    area,
}: {
    heading?: string;
    area?: { slug: string; townKeys: string[] } | null;
}) {
    if (!area || !guestExperiencesOpen()) return null;

    const mp = await loadPublicMarketplace(adminClient(), true);
    if (!mp.open) return null;

    const shown = mp.providers.filter((p) => !!p.hero && servesTown(p, area));
    if (shown.length === 0) return null;

    return (
        <section className="mt-16" aria-labelledby="town-experiences">
            <h2 id="town-experiences" className="text-2xl md:text-3xl font-bold text-stone-900 border-b border-stone-200 pb-4 mb-8">{heading}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                {shown.map((p) => <ExperienceCard key={p.id} p={p} />)}
            </div>
        </section>
    );
}

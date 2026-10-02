import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace } from '@/lib/experiencesData';
import { coversPoint } from '@/lib/serviceProviders';
import ProviderCard from '@/components/marketplace/ProviderCard';

// Experiences for one PLACE — the listing page and each town page — rather than
// the whole region. HomeExperiences shows everything; this shows the ones a
// guest on this stay could actually have: a provider BASED in this town, or one
// whose travel area COVERS this point.
//
// "Covers it within their travel area" is the provider's own service_areas
// circles (town centre + radius), the same shape coverage was always declared
// as; coversPoint is the same test the service pages use. "Based in the area"
// is based_line naming the town — derived from the provider's collection town,
// so it is the town they work from. Either one qualifies.
//
// Self-gating exactly like HomeExperiences: nothing while GUEST_EXPERIENCES_OPEN
// is unset, nothing when no live provider matches — a page never advertises an
// empty shelf. Same starless ProviderCard, the design benchmark for a card.
const MAX = 4;

export default async function AreaExperiences({
    lat,
    lng,
    townLabel,
    heading = 'Experiences nearby',
    intro,
}: {
    lat: number | null | undefined;
    lng: number | null | undefined;
    townLabel: string | null | undefined;
    heading?: string;
    intro?: string;
}) {
    if (!guestExperiencesOpen()) return null;

    const admin = adminClient();
    const mp = await loadPublicMarketplace(admin, true);
    if (!mp.open || mp.providers.length === 0) return null;

    const withPhoto = mp.providers.filter((p) => !!p.hero);
    if (withPhoto.length === 0) return null;

    // The coverage circles for exactly these providers, so "covers this point"
    // is their real declared travel area rather than a guess.
    const ids = withPhoto.map((p) => p.id);
    const { data: areaRows } = await admin
        .from('service_areas')
        .select('provider_id, centre_lat, centre_lng, radius_miles')
        .in('provider_id', ids);

    const circles: Record<string, { centre_lat: number; centre_lng: number; radius_miles: number }[]> = {};
    (areaRows || []).forEach((r: any) => {
        (circles[r.provider_id] ||= []).push({
            centre_lat: Number(r.centre_lat),
            centre_lng: Number(r.centre_lng),
            radius_miles: Number(r.radius_miles),
        });
    });

    const town = (townLabel || '').trim().toLowerCase();
    const hasPoint = lat != null && lng != null && isFinite(Number(lat)) && isFinite(Number(lng));

    const near = withPhoto.filter((p) => {
        // Based in this town.
        if (town && p.based_line && p.based_line.toLowerCase().includes(town)) return true;
        // Travel area covers this property.
        if (hasPoint && coversPoint(circles[p.id] || [], Number(lat), Number(lng))) return true;
        return false;
    });

    if (near.length === 0) return null;
    const shown = near.slice(0, MAX);

    return (
        <section className="mt-16 pt-10 border-t border-slate-200">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900">{heading}</h2>
                    <p className="text-slate-600 text-sm md:text-base mt-1">
                        {intro || 'Local chefs, bakers, saunas and guides who come to this area — add one to your stay.'}
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

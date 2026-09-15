import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadMarketplace } from '@/lib/experiencesData';
import ProviderCard from '@/components/marketplace/ProviderCard';

// Experiences a guest could book FOR THIS STAY — scoped to their booking, so
// it's a real offer (near the cottage, available on their dates) rather than a
// generic list. Shown beneath the trip card, in the place the properties grid
// held for a visitor. Only ones with a photo; nothing when the feature is closed
// or there's nothing bookable, so the section never opens empty.
const MAX = 8;

export default async function StayBookableGrid({ userId, bookingId }: { userId: string; bookingId: string }) {
    if (!guestExperiencesOpen()) return null;

    const admin = adminClient();
    const mp = await loadMarketplace(admin, userId, bookingId, true);
    const providers = mp.providers.filter((p) => !!p.hero).slice(0, MAX);
    if (providers.length === 0) return null;

    return (
        <div className="mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                {providers.map((p) => (
                    <ProviderCard key={p.id} p={p} href={`/experiences/${bookingId}/${p.id}`} />
                ))}
            </div>
        </div>
    );
}

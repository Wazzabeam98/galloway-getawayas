export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { audienceForTrade } from '@/lib/serviceProviders';
import { dashboardProviders, firstProviderPageFor } from '@/lib/providerAccess';
import { getImageUrl } from '@/lib/utils';
import ProviderListingCard, { type ProviderCardItem } from '@/components/services/ProviderListingCard';
import AddListingChooser from '@/components/services/AddListingChooser';

export const metadata = {
    title: 'Your listing',
    robots: { index: false, follow: false },
};

// "Your listing", the experience provider's twin of a holiday-let host's
// "Your listings" (/dashboard): a heading with a + to add another, and a card
// for each listing they can work on — their own and any they co-host with the
// listing permission — opening its editor (/services/dashboard/listing). The
// menu's "Your listing" opens this rather than dropping them straight into the
// editor (Liam, 21 Oct 2026).
//
// The +, Airbnb's "What would you like to host?": a holiday let, or an
// experience. One experience business per account stays the rule (decided
// 1 Sep 2026, unique(owner_id, trade)), so for someone who already has one the
// experience option says so and points at their menu, where more goes.
//
// A trade has no experience listing; its "Your listing" is the business editor,
// so it is sent straight on to it as before.
export default async function ProviderListingsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const { rows, access } = await dashboardProviders(admin, user.id, 'can_listing',
        'id, owner_id, business_name, custom_label, trade, audience, status, photos, headshot, collection_town, based_line, owner_paused, admin_hidden_at');
    const guest = (rows as any[]).filter((r) => r.audience === 'guest' || audienceForTrade(r.trade) === 'guest');
    if (guest.length === 0) {
        if (rows.length > 0) redirect('/services/dashboard/edit');
        redirect((await firstProviderPageFor(user.id)) || '/services/dashboard');
    }

    const ownsExperience = guest.some((r) => access[r.id] && access[r.id].isOwner);
    const items: ProviderCardItem[] = guest.map((r) => {
        const photo = (Array.isArray(r.photos) && r.photos[0]) || r.headshot || null;
        const place = String(r.based_line || r.collection_town || '').trim();
        return {
            id: r.id,
            title: r.business_name || 'Your experience',
            category: r.custom_label || null,
            place: place ? place + ', Dumfries and Galloway' : null,
            image: photo ? getImageUrl(String(photo)) : null,
            status: r.status,
            paused: r.owner_paused === true,
            takenDown: !!r.admin_hidden_at,
            cohosted: !(access[r.id] && access[r.id].isOwner),
        };
    });

    return (
        <div className="max-w-7xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Your listing</h1>
                <AddListingChooser ownsExperience={ownsExperience} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.map((item) => <ProviderListingCard key={item.id} item={item} />)}
            </div>
        </div>
    );
}

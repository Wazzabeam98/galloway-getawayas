import { formatGBP } from '@/lib/formatMoney';
import { unitLabel, type ListingExtra } from '@/lib/listingExtras';

// "Extras this host offers" on the listing page — a guest sees the sauna pack
// or the hamper while they are still deciding, the way Vrbo tells hosts to
// describe optional extras on the listing (Airbnb shows none here at all). It
// is informational: the actual choosing and pricing happens in the booking
// card at checkout, so all the money lives in one place.
//
// Deliberately FLAT, in the same visual language as the experiences menu
// (components/marketplace/FoodMenu) — a scan surface, not a lifted card you act
// on (see CLAUDE.md). Renders nothing until the host has a live extra.
export default function ListingExtras({ extras }: { extras: ListingExtra[] }) {
    const live = (extras || []).filter((e) => e && e.active !== false);
    if (!live.length) return null;

    return (
        <div id="extras" className="mt-8 pt-8 border-t scroll-mt-24">
            <h2 className="text-xl font-semibold mb-1">Extras this host offers</h2>
            <p className="text-sm text-slate-500 mb-4">Optional, and added when you book.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {live.map((e) => (
                    <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="font-medium text-slate-900">{e.label}</span>
                            <span className="flex-shrink-0 text-sm text-slate-600 tabular-nums">
                                {formatGBP(Number(e.price))}
                                <span className="text-slate-400"> {unitLabel(e.unit)}</span>
                            </span>
                        </div>
                        {e.description && <p className="mt-1 text-sm text-slate-500">{e.description}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
}

import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { getImageUrl } from '@/lib/utils';
import HotelDecider from './HotelDecider';

export const dynamic = 'force-dynamic';

// Admin review of hotels waiting to go live — the hotel twin of /admin/listings,
// minimal for phase one. requireAdmin() 404s anyone who is not an admin.
export default async function AdminHotelsPage() {
    await requireAdmin();

    const admin = adminClient();
    const { data: pending } = await admin
        .from('hotels')
        .select('id, name, property_type, location, images, created_at, hotel_room_types ( id )')
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true });

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
                <h1 className="text-2xl font-bold text-slate-900">Hotels waiting for review</h1>
                {(pending || []).length === 0 ? (
                    <p className="mt-6 text-slate-600">Nothing waiting.</p>
                ) : (
                    <div className="mt-6 space-y-4">
                        {(pending || []).map((h: any) => (
                            <div key={h.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex gap-4 items-center">
                                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                                    {(h.images || [])[0] && <img src={getImageUrl(h.images[0])} alt="" className="h-full w-full object-cover" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-slate-900 truncate">{h.name || 'Untitled'}</p>
                                    <p className="text-sm text-slate-600">{h.property_type} · {h.location || 'no location'} · {(h.hotel_room_types || []).length} room type(s)</p>
                                    <a href={`/hotels/${h.id}`} className="text-sm text-emerald-700 hover:underline">Preview is only visible once published</a>
                                </div>
                                <HotelDecider id={h.id} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

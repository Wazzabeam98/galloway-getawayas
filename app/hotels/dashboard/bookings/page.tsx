import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { hotelsOpen } from '@/lib/hotels';
import { displayName } from '@/lib/utils';
import { ukDate } from '@/lib/dayKey';
import { MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
    confirmed: 'bg-emerald-100 text-emerald-800',
    completed: 'bg-slate-100 text-slate-600',
    pending: 'bg-amber-100 text-amber-800',
    cancelled: 'bg-rose-100 text-rose-700',
    pending_payment: 'bg-slate-100 text-slate-500',
};

// The owner's hotel bookings. Keyed by the owner's hotels' room types (a hotel
// booking carries room_type_id, not listing_id). Messages link into the existing
// /messages inbox, where the thread already lives.
export default async function HotelBookingsPage({ searchParams }: { searchParams: { hotel?: string } }) {
    if (!hotelsOpen()) notFound();

    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/addhotel');

    const admin = adminClient();
    let hotelQuery = admin.from('hotels').select('id, name').eq('owner_id', user.id);
    if (searchParams?.hotel) hotelQuery = hotelQuery.eq('id', searchParams.hotel);
    const { data: hotels } = await hotelQuery;
    const hotelIds = (hotels || []).map((h: any) => h.id);
    const hotelName: Record<string, string> = {};
    (hotels || []).forEach((h: any) => { hotelName[h.id] = h.name; });

    const { data: rooms } = hotelIds.length
        ? await admin.from('hotel_room_types').select('id, hotel_id, name').in('hotel_id', hotelIds)
        : { data: [] as any[] };
    const roomInfo: Record<string, { hotel_id: string; name: string }> = {};
    (rooms || []).forEach((r: any) => { roomInfo[r.id] = { hotel_id: r.hotel_id, name: r.name }; });
    const roomIds = Object.keys(roomInfo);

    const { data: bookings } = roomIds.length
        ? await admin
            .from('bookings')
            .select('id, room_type_id, guest_id, check_in, check_out, guests, total_price, status, created_at')
            .in('room_type_id', roomIds)
            .order('check_in', { ascending: false })
        : { data: [] as any[] };

    const guestIds = Array.from(new Set((bookings || []).map((b: any) => b.guest_id)));
    const { data: guests } = guestIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', guestIds)
        : { data: [] as any[] };
    const guestById: Record<string, any> = {};
    (guests || []).forEach((g: any) => { guestById[g.id] = g; });

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
                <div className="flex items-center gap-3 mb-6">
                    <Link href="/hotels/dashboard" className="text-sm font-semibold text-emerald-700 hover:underline">← Dashboard</Link>
                    <h1 className="text-2xl font-bold text-slate-900">Bookings</h1>
                </div>

                {(bookings || []).length === 0 ? (
                    <p className="text-slate-600">No bookings yet.</p>
                ) : (
                    <div className="space-y-3">
                        {(bookings || []).map((b: any) => {
                            const room = roomInfo[b.room_type_id];
                            const guestFirst = displayName(guestById[b.guest_id] || {}, 'A guest').split(' ')[0];
                            return (
                                <div key={b.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-slate-900 truncate">{room?.name || 'Room'}</span>
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[b.status] || 'bg-slate-100 text-slate-600'}`}>{b.status.replace('_', ' ')}</span>
                                        </div>
                                        <p className="text-sm text-slate-600">{guestFirst} · {ukDate(b.check_in)} → {ukDate(b.check_out)} · {b.guests} guest(s)</p>
                                        <p className="text-sm text-slate-500">{hotelName[room?.hotel_id || ''] || ''} · £{Number(b.total_price).toFixed(0)}</p>
                                    </div>
                                    <Link href={`/messages?b=${b.id}`} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                                        <MessageSquare className="h-3.5 w-3.5" /> Message
                                    </Link>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
    );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getImageUrl } from '@/lib/utils';
import { Pencil, Eye, Calendar, CalendarCheck, MessageSquare, Check } from 'lucide-react';

type Room = { id: string; name: string; inventory_count: number; price_per_night: number; breakfast_included: boolean };
type Hotel = { id: string; name: string; status: string; property_type: string; location: string | null; images: string[] | null };

const STATUS: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-600' },
    pending_review: { label: 'In review', cls: 'bg-amber-100 text-amber-800' },
    published: { label: 'Live', cls: 'bg-emerald-100 text-emerald-800' },
    hidden: { label: 'Hidden', cls: 'bg-slate-200 text-slate-700' },
};

export default function HotelDashboard({ hotels, roomsByHotel, bookingCount }: {
    hotels: Hotel[];
    roomsByHotel: Record<string, Room[]>;
    bookingCount: Record<string, number>;
}) {
    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-slate-900">Your hotels</h1>
                    <Link href="/addhotel" className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Add a hotel</Link>
                </div>

                {hotels.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
                        <p className="text-slate-600">You haven’t added a hotel yet.</p>
                        <Link href="/addhotel" className="mt-3 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">List your hotel</Link>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {hotels.map((h) => (
                            <HotelCard key={h.id} hotel={h} rooms={roomsByHotel[h.id] || []} bookings={bookingCount[h.id] || 0} />
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

function HotelCard({ hotel, rooms, bookings }: { hotel: Hotel; rooms: Room[]; bookings: number }) {
    const st = STATUS[hotel.status] || STATUS.draft;
    const cover = (hotel.images || []).filter(Boolean)[0];
    return (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex gap-4 p-4">
                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {cover && <img src={getImageUrl(cover)} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h2 className="font-bold text-slate-900 truncate">{hotel.name || 'Untitled hotel'}</h2>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-sm text-slate-500">{hotel.location || 'No location'} · {rooms.length} room type(s) · {bookings} booking(s)</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <Link href={`/addhotel?draft=${hotel.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
                        {hotel.status === 'published' && <Link href={`/hotels/${hotel.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> View</Link>}
                        <Link href={`/hotels/dashboard/calendar?hotel=${hotel.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Calendar className="h-3.5 w-3.5" /> Availability</Link>
                        <Link href={`/hotels/dashboard/bookings?hotel=${hotel.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><CalendarCheck className="h-3.5 w-3.5" /> Bookings</Link>
                        <Link href="/messages" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><MessageSquare className="h-3.5 w-3.5" /> Messages</Link>
                    </div>
                </div>
            </div>

            {rooms.length > 0 && (
                <div className="border-t border-slate-100 px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Rooms &amp; prices</h3>
                    <div className="space-y-1.5">
                        {rooms.map((r) => <RoomRow key={r.id} hotelId={hotel.id} room={r} />)}
                    </div>
                </div>
            )}
        </div>
    );
}

// Inline price + inventory edit, saved through /api/hotels/save (the roomTypes
// path updates by id). Changing a published room's price takes effect at once.
function RoomRow({ hotelId, room }: { hotelId: string; room: Room }) {
    const [price, setPrice] = useState(String(room.price_per_night));
    const [count, setCount] = useState(String(room.inventory_count));
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dirty = price !== String(room.price_per_night) || count !== String(room.inventory_count);

    async function save() {
        setSaving(true); setError(null); setDone(false);
        try {
            // Targeted route — updates only this room's price + inventory, never
            // the others (unlike the replace-set roomTypes path).
            const res = await fetch('/api/hotels/room', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hotelId, roomId: room.id, price_per_night: Number(price), inventory_count: Number(count) }),
            });
            const body = await res.json().catch(() => ({}));
            if (!body.ok) { setError(body.error || 'Could not save.'); setSaving(false); return; }
            room.price_per_night = Number(price); room.inventory_count = Number(count);
            setDone(true);
        } catch { setError('Something went wrong.'); }
        setSaving(false);
    }

    return (
        <div className="flex items-center gap-3 text-sm">
            <span className="flex-1 truncate text-slate-800">{room.name}</span>
            <label className="inline-flex items-center gap-1 text-slate-500">rooms
                <input type="number" min={1} value={count} onChange={(e) => { setCount(e.target.value); setDone(false); }} className="w-16 rounded border border-slate-300 px-2 py-1" />
            </label>
            <label className="inline-flex items-center gap-1 text-slate-500">£
                <input type="number" min={1} value={price} onChange={(e) => { setPrice(e.target.value); setDone(false); }} className="w-20 rounded border border-slate-300 px-2 py-1" />
            </label>
            <button type="button" onClick={save} disabled={!dirty || saving}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-30">
                {saving ? '…' : done ? <Check className="h-3.5 w-3.5" /> : 'Save'}
            </button>
            {error && <span className="text-xs text-rose-700">{error}</span>}
        </div>
    );
}

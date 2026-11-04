'use client';

import { useMemo, useState } from 'react';
import { Star, MapPin, Users, Maximize, Check } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
import { AGREEMENTS } from '@/lib/agreements';
import AgreementTick from '@/components/legal/AgreementTick';
import { BED_LABELS, type BedConfigEntry } from '@/lib/hotels';

// A hotel's public page — Booking.com's shape (photo grid, a title block, a
// facilities strip, then one card per room type with its price and a Reserve
// button driven by the dates chosen once at the top), in our own look: the
// lifted-card style (rounded-2xl border bg-white shadow) for the surfaces a
// guest acts on — the Your-stay panel and each room card — on a bg-slate-50
// page, flat everything else. No calendar here (native date inputs), so no
// today-marker concern.

type Hotel = {
    id: string;
    name: string;
    description: string | null;
    star_rating: number | null;
    property_type: string | null;
    location: string | null;
    street_address: string | null;
    check_in_time: string | null;
    check_out_time: string | null;
    facilities: string[] | null;
    house_rules: string | null;
    cancellation_policy: string | null;
    images: string[] | null;
};

type RoomType = {
    id: string;
    name: string;
    description: string | null;
    inventory_count: number;
    max_adults: number;
    max_children: number;
    max_occupancy: number;
    size_sqm: number | null;
    bed_config: BedConfigEntry[] | null;
    amenities: string[] | null;
    images: string[] | null;
    price_per_night: number;
    min_nights: number;
};

const PROPERTY_LABELS: Record<string, string> = {
    hotel: 'Hotel', bnb: 'Bed & breakfast', guesthouse: 'Guest house', inn: 'Inn', aparthotel: 'Aparthotel',
};

function todayKey(): string {
    // London calendar day, so a guest abroad and the server agree.
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return parts; // en-CA gives yyyy-mm-dd
}

function nights(a: string, b: string): number {
    if (!a || !b) return 0;
    const d = (Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000));
    return d > 0 ? d : 0;
}

function bedSummary(cfg: BedConfigEntry[] | null): string {
    if (!cfg || !cfg.length) return '';
    return cfg.map((b) => `${b.count} × ${(BED_LABELS as any)[b.type] || b.type}`).join(', ');
}

export default function HotelView({ hotel, roomTypes }: { hotel: Hotel; roomTypes: RoomType[] }) {
    const today = todayKey();
    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [adults, setAdults] = useState(2);
    const [children, setChildren] = useState(0);
    const [agreed, setAgreed] = useState(false);
    const [agreeError, setAgreeError] = useState<string | undefined>();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const stayNights = nights(checkIn, checkOut);
    const photos = (hotel.images || []).filter(Boolean);

    const datesChosen = !!checkIn && !!checkOut && stayNights > 0;

    async function reserve(rt: RoomType) {
        setError(null);
        setAgreeError(undefined);
        if (!datesChosen) { setError('Choose your check-in and check-out dates first.'); return; }
        if (!agreed) { setAgreeError('Please agree to the Guest Terms to continue.'); return; }
        setBusyId(rt.id);
        try {
            const res = await fetch('/api/hotels/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomTypeId: rt.id,
                    checkIn,
                    checkOut,
                    adults,
                    children,
                    guestTermsVersion: AGREEMENTS.guest.version,
                }),
            });
            if (res.status === 401) {
                setError('Please sign in to book this room — use “Log in or sign up” at the top of the page.');
                setBusyId(null);
                return;
            }
            const body = await res.json().catch(() => ({}));
            if (body.ok && body.url) { window.location.href = body.url; return; }
            if (body.needsAgreement) setAgreeError(body.error || 'Please agree to the Guest Terms.');
            else setError(body.error || 'Sorry — we couldn’t start that booking.');
        } catch {
            setError('Something went wrong. Please try again.');
        }
        setBusyId(null);
    }

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
                {/* Title */}
                <div className="mb-4">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">{PROPERTY_LABELS[hotel.property_type || ''] || 'Hotel'}</span>
                        {hotel.star_rating ? (
                            <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={`${hotel.star_rating}-star`}>
                                {Array.from({ length: hotel.star_rating }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                            </span>
                        ) : null}
                    </div>
                    <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900">{hotel.name}</h1>
                    {hotel.location && (
                        <p className="mt-1 inline-flex items-center gap-1 text-sm text-slate-600">
                            <MapPin className="h-4 w-4" /> {hotel.street_address ? `${hotel.street_address}, ` : ''}{hotel.location}
                        </p>
                    )}
                </div>

                {/* Photo grid */}
                {photos.length > 0 && (
                    <div className="grid grid-cols-4 gap-2 rounded-2xl overflow-hidden mb-6" style={{ maxHeight: 420 }}>
                        <img src={getImageUrl(photos[0])} alt={hotel.name} className="col-span-4 sm:col-span-2 row-span-2 h-full w-full object-cover" style={{ minHeight: 260 }} />
                        {photos.slice(1, 5).map((p, i) => (
                            <img key={i} src={getImageUrl(p)} alt="" className="hidden sm:block h-full w-full object-cover" style={{ minHeight: 128 }} />
                        ))}
                    </div>
                )}

                <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        {hotel.description && (
                            <section>
                                <h2 className="text-lg font-bold text-slate-900 mb-2">About this place</h2>
                                <p className="text-slate-700 whitespace-pre-line leading-relaxed">{hotel.description}</p>
                            </section>
                        )}

                        {(hotel.facilities || []).length > 0 && (
                            <section>
                                <h2 className="text-lg font-bold text-slate-900 mb-3">Facilities</h2>
                                <ul className="grid grid-cols-2 gap-y-2 gap-x-4">
                                    {(hotel.facilities || []).map((f) => (
                                        <li key={f} className="inline-flex items-center gap-2 text-sm text-slate-700">
                                            <Check className="h-4 w-4 text-emerald-700" /> {f}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        <section className="text-sm text-slate-600">
                            <span className="mr-4">Check-in from {hotel.check_in_time || '15:00'}</span>
                            <span>Check-out by {hotel.check_out_time || '11:00'}</span>
                        </section>
                    </div>

                    {/* Your stay — a lifted card */}
                    <aside className="lg:col-span-1">
                        <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] p-5 lg:sticky lg:top-24">
                            <h2 className="text-base font-bold text-slate-900 mb-3">Your stay</h2>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="text-xs font-semibold text-slate-600">
                                    Check-in
                                    <input type="date" value={checkIn} min={today} onChange={(e) => setCheckIn(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900" />
                                </label>
                                <label className="text-xs font-semibold text-slate-600">
                                    Check-out
                                    <input type="date" value={checkOut} min={checkIn || today} onChange={(e) => setCheckOut(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900" />
                                </label>
                                <label className="text-xs font-semibold text-slate-600">
                                    Adults
                                    <input type="number" min={1} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value)))}
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900" />
                                </label>
                                <label className="text-xs font-semibold text-slate-600">
                                    Children
                                    <input type="number" min={0} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value)))}
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900" />
                                </label>
                            </div>
                            {datesChosen && <p className="mt-3 text-sm text-slate-600">{stayNights} night{stayNights === 1 ? '' : 's'}</p>}
                            <div className="mt-3">
                                <AgreementTick doc="guest" checked={agreed} onChange={setAgreed} error={agreeError} />
                            </div>
                            <p className="mt-3 text-xs text-slate-500">Pick your dates, then choose a room below.</p>
                        </div>
                    </aside>
                </div>

                {/* Room types */}
                <section className="mt-8">
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Choose your room</h2>
                    {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
                    <div className="space-y-4">
                        {roomTypes.map((rt) => {
                            const roomPhotos = (rt.images || []).filter(Boolean);
                            const stayTotal = datesChosen ? rt.price_per_night * stayNights : 0;
                            return (
                                <div key={rt.id} className="rounded-2xl border border-slate-200 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] overflow-hidden">
                                    <div className="grid sm:grid-cols-[200px_1fr_220px]">
                                        {roomPhotos[0] ? (
                                            <img src={getImageUrl(roomPhotos[0])} alt={rt.name} className="h-40 sm:h-full w-full object-cover" />
                                        ) : (
                                            <div className="h-40 sm:h-full w-full bg-slate-100" />
                                        )}
                                        <div className="p-4">
                                            <h3 className="font-bold text-slate-900">{rt.name}</h3>
                                            {rt.description && <p className="mt-1 text-sm text-slate-600 line-clamp-2">{rt.description}</p>}
                                            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                                                <li className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> Sleeps {rt.max_occupancy}</li>
                                                {rt.size_sqm ? <li className="inline-flex items-center gap-1"><Maximize className="h-4 w-4" /> {rt.size_sqm} m²</li> : null}
                                                {bedSummary(rt.bed_config) ? <li>{bedSummary(rt.bed_config)}</li> : null}
                                            </ul>
                                            {(rt.amenities || []).length > 0 && (
                                                <ul className="mt-2 flex flex-wrap gap-2">
                                                    {(rt.amenities || []).slice(0, 5).map((a) => (
                                                        <li key={a} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{a}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                        <div className="p-4 border-t sm:border-t-0 sm:border-l border-slate-100 flex flex-col justify-between">
                                            <div className="text-right">
                                                <div className="text-lg font-bold text-slate-900">£{Number(rt.price_per_night).toFixed(0)}</div>
                                                <div className="text-xs text-slate-500">per night</div>
                                                {datesChosen && (
                                                    <div className="mt-1 text-sm text-slate-700">£{stayTotal.toFixed(0)} total</div>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => reserve(rt)}
                                                disabled={busyId === rt.id}
                                                className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                                            >
                                                {busyId === rt.id ? 'Starting…' : 'Reserve'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>
        </main>
    );
}

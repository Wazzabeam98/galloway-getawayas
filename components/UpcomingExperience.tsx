'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Home } from 'lucide-react';
import DirectionsPicker from '@/components/arrival/DirectionsPicker';

// The "Your upcoming experience" cards on the logged-in home page — peers of the
// trip card. An experience is its own booking (it can be bought with no stay at
// all), so it stands on its own. Same lift as the trip card (reused classes, no
// variant), but not the trip card's full-width hero shape: each is a contained
// card so two booked experiences sit side by side on desktop and stack on a
// phone. No big countdown — the hero treatment is for the stay, which is the
// anchor; an experience just needs its title, date and time.
//
// Data comes from /api/services/to-review's `upcoming` (the guest's own confirmed
// orders still to come). Renders NOTHING when there's none — no empty shelf.

interface Upcoming {
    orderId: string;
    title: string;
    providerName: string | null;
    serviceDate: string;
    serviceTime: string | null;
    photo: string | null;
    // Google + Apple to a fixed venue; null for a comes-to-you provider, which
    // travels to the guest and so has nowhere to navigate to.
    directions: { google: string | null; apple: string | null } | null;
}

const MAX_ON_HOME = 2;

function dayLabel(dateStr: string): string {
    const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function timeLabel(t: string | null): string {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h)) return '';
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = ((h + 11) % 12) + 1;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ampm;
}

export default function UpcomingExperience() {
    const [list, setList] = useState<Upcoming[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/api/services/to-review')
            .then((r) => r.json())
            .then((d) => { setList((d && d.upcoming) || []); setLoaded(true); })
            .catch(() => setLoaded(true));
    }, []);

    if (!loaded || list.length === 0) return null;

    // Two side by side; the rest of a guest's booked experiences (and the browse
    // link) live on /trips, so any beyond that are routed there rather than dropped.
    const shown = list.slice(0, MAX_ON_HOME);
    const moreCount = list.length - shown.length;

    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14">
            <div className="mb-6 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                    {list.length > 1 ? 'Your upcoming experiences' : 'Your upcoming experience'}
                </h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">Booked for your time in Dumfries &amp; Galloway</p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {shown.map((it) => {
                    const href = `/experiences/order/${it.orderId}`;
                    const when = dayLabel(it.serviceDate) + (it.serviceTime ? ' · ' + timeLabel(it.serviceTime) : '');
                    return (
                        // Same lift as the trip card. Photo is inset (its own
                        // rounded box) so the directions dropdown isn't clipped.
                        <div key={it.orderId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                            <Link href={href} className="group block aspect-[16/9] w-full overflow-hidden rounded-xl bg-stone-200">
                                {it.photo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={it.photo} alt={it.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                                ) : null}
                            </Link>
                            <div className="mt-3">
                                <Link href={href} className="text-base font-semibold text-stone-900 hover:underline">{it.title}</Link>
                                {it.providerName && <div className="mt-0.5 text-[13px] text-stone-500">{it.providerName}</div>}
                                <div className="mt-1.5 text-[13px] font-medium text-stone-700">{when}</div>
                                <div className="mt-3">
                                    {it.directions && (it.directions.google || it.directions.apple) ? (
                                        <DirectionsPicker compact google={it.directions.google} apple={it.directions.apple} />
                                    ) : (
                                        // Where the other card has a button — so the space reads as
                                        // deliberate, not missing. A comes-to-you provider travels to
                                        // the guest, so there's nowhere to send them.
                                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[13px] font-medium text-stone-500">
                                            <Home className="h-4 w-4" /> They come to you
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {moreCount > 0 && (
                <div className="mt-4">
                    <Link href="/trips" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4">
                        {moreCount === 1 ? '1 more on your trip' : moreCount + ' more on your trip'}
                    </Link>
                </div>
            )}
        </section>
    );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';

// The "Your upcoming experience" card on the logged-in home page — the peer of
// UpcomingTrip. An experience is its own booking (it can even be bought with no
// stay at all), so it stands as its own card rather than nesting inside the trip
// card. Same shape and the same lift as the trip card (reused classes, no new
// variant): photo left, the details beside it, an action below.
//
// Data comes from /api/services/to-review's `upcoming` (the guest's own
// confirmed orders still to come, nearest first) — the same endpoint the review
// prompt reads, extended rather than duplicated. Renders NOTHING when there's no
// upcoming experience, the way the home experiences section does — no empty shelf.

interface Upcoming {
    orderId: string;
    title: string;
    providerName: string | null;
    serviceDate: string;
    serviceTime: string | null;
    photo: string | null;
}

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

function countdown(dateStr: string): string {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const when = new Date(dateStr.slice(0, 10) + 'T00:00:00');
    const days = Math.round((when.getTime() - today.getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return 'In ' + days + ' days';
}

export default function UpcomingExperience() {
    const [item, setItem] = useState<Upcoming | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/api/services/to-review')
            .then((r) => r.json())
            .then((d) => { setItem((d && d.upcoming && d.upcoming[0]) || null); setLoaded(true); })
            .catch(() => setLoaded(true));
    }, []);

    if (!loaded || !item) return null;

    const when = dayLabel(item.serviceDate) + (item.serviceTime ? ' · ' + timeLabel(item.serviceTime) : '');
    const href = `/experiences/order/${item.orderId}`;

    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14">
            <div className="mb-6 border-b border-stone-200 pb-4">
                <h2 className="text-2xl md:text-3xl font-bold text-stone-900">Your upcoming experience</h2>
                <p className="text-stone-600 text-sm md:text-base mt-1">Booked for your time in Dumfries &amp; Galloway</p>
            </div>

            {/* Same lift as the trip card. */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <div className="md:flex md:items-start md:gap-8">
                    <div className="mb-6 md:mb-0 md:w-1/4 md:flex-none">
                        <Link href={href} className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-stone-200 md:aspect-square">
                            {item.photo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.photo} alt={item.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                            ) : null}
                        </Link>
                    </div>
                    <div className="md:min-w-0 md:flex-1">
                        <div className="text-4xl md:text-5xl font-bold text-stone-900 tracking-tight">{countdown(item.serviceDate)}</div>
                        <div className="mt-6 space-y-1">
                            <Link href={href} className="text-lg font-semibold text-stone-900 hover:underline">{item.title}</Link>
                            {item.providerName && <div className="text-stone-500">{item.providerName}</div>}
                        </div>
                        <div className="mt-5 pt-5 border-t border-stone-100 text-stone-700">
                            <div className="font-medium">{when}</div>
                        </div>
                        <div className="mt-8">
                            <Link href={href} className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition">
                                <CalendarDays className="w-4 h-4" /> View experience
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

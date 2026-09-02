'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock3, XCircle, ArrowRight, ChevronRight } from 'lucide-react';

// The trip page's window into the marketplace: a way IN, and the guest's own
// experience bookings shown back — grouped the way a guest reads them, each a
// link to the booking's own page (where the details, the thread and the cancel
// live). No floating message box on the list any more; a booking is a page.

interface Order {
    id: string;
    status: string;
    service_date: string;
    service_time: string | null;
    price: number;
    item_name: string | null;
    provider_business_name: string | null;
}

type Tone = 'ok' | 'wait' | 'over';

// One label per status, written so a guest knows which is which at a glance.
const STATUS: Record<string, { label: string; group: 'happening' | 'waiting' | 'over'; tone: Tone }> = {
    confirmed: { label: 'Confirmed', group: 'happening', tone: 'ok' },
    authorised: { label: 'Waiting to be confirmed', group: 'waiting', tone: 'wait' },
    holding: { label: 'Holding your place…', group: 'waiting', tone: 'wait' },
    declined: { label: 'Provider couldn’t make it', group: 'over', tone: 'over' },
    expired: { label: 'Expired · no reply', group: 'over', tone: 'over' },
    cancelled: { label: 'You cancelled', group: 'over', tone: 'over' },
    refunded: { label: 'Cancelled · refunded', group: 'over', tone: 'over' },
};

const PILL: Record<Tone, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    wait: 'bg-amber-100 text-amber-800',
    over: 'bg-slate-100 text-slate-500',
};

const GROUPS: { key: 'happening' | 'waiting' | 'over'; title: string }[] = [
    { key: 'happening', title: 'Booked for your stay' },
    { key: 'waiting', title: 'Waiting on the provider' },
    { key: 'over', title: 'Earlier' },
];

function whenLabel(dateStr: string, timeStr: string | null): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = isNaN(d.getTime())
        ? dateStr
        : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!timeStr) return day;
    const t = timeStr.length >= 5 ? timeStr.slice(0, 5) : timeStr;
    return day + ' · ' + t;
}

export default function GuestExperiences(props: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    town?: string | null;
}) {
    const { bookingId, town } = props;

    const [providerCount, setProviderCount] = useState(0);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);

    const load = useCallback(() => {
        return fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => {
                setOpen(d && d.open !== false);
                setProviderCount(((d && d.providers) || []).length);
                setOrders((d && d.orders) || []);
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, [bookingId]);

    useEffect(() => { load(); }, [load]);

    if (!loaded) return null;

    if (!open) {
        return (
            <section className="rounded-2xl border border-dashed border-slate-300 p-5">
                <h3 className="text-lg font-semibold text-slate-900">Experiences, coming soon to your stay</h3>
                <p className="mt-1 text-sm text-slate-500">
                    Local experiences you’ll be able to book for your dates — a chef, a cake, a sauna, a
                    guided walk. We’re lining up businesses now.
                </p>
            </section>
        );
    }

    if (providerCount === 0 && orders.length === 0) return null;

    const grouped = GROUPS
        .map((g) => ({ ...g, rows: orders.filter((o) => (STATUS[o.status]?.group || 'over') === g.key) }))
        .filter((g) => g.rows.length > 0);

    return (
        <section>
            {providerCount > 0 && (
                <Link
                    href={`/experiences/${bookingId}`}
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">Book an experience for your stay{town ? ' near ' + town : ''}</h3>
                        <p className="mt-1 text-sm text-slate-600">Chefs, bakers, saunas and guided walks — local businesses you can book for your dates.</p>
                    </div>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-emerald-700 transition group-hover:translate-x-0.5">
                        Browse <ArrowRight className="h-4 w-4" />
                    </span>
                </Link>
            )}

            {orders.length > 0 && (
                <div className="mt-4 space-y-5">
                    {grouped.map((g) => (
                        <div key={g.key}>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</h4>
                            <div className="space-y-2">
                                {g.rows.map((o) => {
                                    const meta = STATUS[o.status] || { label: o.status, tone: 'over' as Tone };
                                    return (
                                        <Link
                                            key={o.id}
                                            href={`/experiences/order/${o.id}`}
                                            className={`flex items-center gap-3 rounded-xl border p-3.5 transition ${meta.tone === 'over' ? 'border-slate-200 bg-slate-50/60 hover:border-slate-300' : 'border-slate-200 bg-white hover:border-emerald-300 hover:shadow-sm'}`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-sm font-semibold ${meta.tone === 'over' ? 'text-slate-500' : 'text-slate-900'} break-words`}>
                                                    {o.item_name || 'Experience'}
                                                </div>
                                                <div className="text-xs text-slate-500">
                                                    {o.provider_business_name ? o.provider_business_name + ' · ' : ''}{whenLabel(o.service_date, o.service_time)} · £{o.price.toFixed(2)}
                                                </div>
                                            </div>
                                            <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                                                {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                                                {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                                                {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                                                {meta.label}
                                            </span>
                                            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

'use client';

// The provider's "Upcoming reservations" — the host's reservation experience,
// for a provider. A full-height list down the left (soonest first, today and
// tomorrow called out); clicking a row opens that reservation in the same card
// the host gets. Works for every kind — a slot session, a chef at a cottage, a
// bakery order to collect or deliver, a tradesperson's job — in each one's own
// wording, from the normalised model in lib/providerReservations.
//
// Money is pre-formatted server-side (strings), same rule as MoneyCards.

import { useState } from 'react';
import { Phone, MessageSquare, ChevronRight, ArrowLeft, CalendarDays } from 'lucide-react';
import type { ProviderReservation } from '@/lib/providerReservations';

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-6 border-b border-slate-100 py-2 last:border-0">
            <div className="text-sm text-slate-500">{label}</div>
            <div className={'text-right text-sm ' + (muted ? 'text-slate-500' : 'font-medium text-slate-900')}>{value}</div>
        </div>
    );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>
            {children}
        </div>
    );
}

function initials(name: string): string {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

// The guest's (or host's) avatar tucked over the item/cottage photo — the same
// treatment the host booking rail uses.
function AvatarOverPhoto({ r, size = 'sm' }: { r: ProviderReservation; size?: 'sm' | 'lg' }) {
    const box = size === 'lg' ? 'h-14 w-14' : 'h-14 w-14';
    const av = size === 'lg' ? 'h-7 w-7' : 'h-7 w-7';
    return (
        <span className="relative flex-none">
            <span className={box + ' block overflow-hidden rounded-xl bg-slate-100'}>
                {r.photoUrl
                    ? <img src={r.photoUrl} alt="" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center text-slate-300"><CalendarDays className="h-6 w-6" /></span>}
            </span>
            <span className={'absolute -bottom-1.5 -right-1.5 ' + av + ' flex items-center justify-center overflow-hidden rounded-full bg-emerald-700 text-[11px] font-semibold text-white ring-2 ring-white'}>
                {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(r.personName)}
            </span>
        </span>
    );
}

function ReservationCard({ r }: { r: ProviderReservation }) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <AvatarOverPhoto r={r} size="lg" />
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-slate-900">{r.groupLabel}</div>
                    <div className="text-sm text-slate-500">{r.reference}</div>
                </div>
            </div>

            <DetailCard title={r.kind === 'trade' ? 'Job' : 'Booking'}>
                <Row label={r.whenHeading} value={r.whenLabel} />
                <Row label={r.kind === 'trade' ? 'What they need' : 'What they booked'} value={r.title} />
                {r.partyLabel && <Row label="Party" value={r.partyLabel} />}
                {r.whereLabel && <Row label={r.kind === 'trade' ? 'Property' : 'Where'} value={r.whereLabel} />}
            </DetailCard>

            {r.allergy && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-rose-800">⚠ Allergy / dietary need</div>
                    <div className="mt-1 whitespace-pre-line text-sm text-rose-950">{r.allergy}</div>
                </div>
            )}
            {r.note && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">In the guest’s words</div>
                    <div className="mt-1 whitespace-pre-line text-sm text-amber-950">{r.note}</div>
                </div>
            )}

            <DetailCard title="Money">
                {r.money.show
                    ? <>
                        {r.money.rows.map((m, i) => <Row key={i} label={m.label} value={m.value} muted={m.muted} />)}
                        {r.money.working && <p className="mt-2 text-xs text-slate-500">{r.money.working}</p>}
                    </>
                    : <p className="text-sm text-slate-600">{r.money.note}</p>}
            </DetailCard>

            <div className="flex gap-2">
                <a href={r.messageHref} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
                    <MessageSquare className="h-4 w-4" /> Message {r.personFirst}
                </a>
                {r.phone && (
                    <a href={'tel:' + r.phone} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500">
                        <Phone className="h-4 w-4" /> Call
                    </a>
                )}
            </div>
        </div>
    );
}

type Filter = 'all' | 'today' | 'week' | 'reply';

function SummaryChips({ s, filter, onPick }: { s: { today: number; thisWeek: number; needsReply: number }; filter: Filter; onPick: (f: Filter) => void }) {
    const chip = (key: Filter, label: string, n: number, amber?: boolean) => {
        const active = filter === key;
        return (
            <button
                type="button"
                onClick={() => onPick(active ? 'all' : key)}
                aria-pressed={active}
                className={'rounded-2xl border p-3 text-left transition '
                    + (active ? 'border-emerald-600 ring-1 ring-emerald-600 bg-emerald-50 '
                        : (amber && n > 0 ? 'border-amber-300 bg-amber-50 hover:border-amber-400 ' : 'border-slate-200 bg-white hover:border-slate-300 '))}
            >
                <div className="text-2xl font-bold text-slate-900">{n}</div>
                <div className="text-xs font-medium text-slate-500">{label}</div>
            </button>
        );
    };
    return (
        <div className="grid grid-cols-3 gap-3">
            {chip('today', 'Today', s.today)}
            {chip('week', 'This week', s.thisWeek)}
            {chip('reply', 'Needs a reply', s.needsReply, true)}
        </div>
    );
}

export default function ProviderUpcoming({ reservations, summary }: { reservations: ProviderReservation[]; summary: { today: number; thisWeek: number; needsReply: number } }) {
    const [filter, setFilter] = useState<Filter>('all');
    const [mobileOpen, setMobileOpen] = useState(false);

    const matches = (r: ProviderReservation, f: Filter) => {
        if (f === 'today') return r.soon === 'Today';
        if (f === 'week') return r.inWeek;
        if (f === 'reply') return r.needsReply;
        return true;
    };
    const filtered = reservations.filter((r) => matches(r, filter));

    const [selectedId, setSelectedId] = useState<string | null>(reservations[0]?.id ?? null);
    const selected = filtered.find((r) => r.id === selectedId) || filtered[0] || null;

    const pick = (f: Filter) => {
        setFilter(f);
        const first = reservations.filter((r) => matches(r, f))[0];
        if (first) setSelectedId(first.id);
    };

    const filterLabel = filter === 'today' ? 'today' : filter === 'week' ? 'this week' : filter === 'reply' ? 'needing a reply' : '';

    return (
        <section id="upcoming" className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Upcoming reservations</h2>
            <SummaryChips s={summary} filter={filter} onPick={pick} />

            {filter !== 'all' && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Showing {filtered.length} {filterLabel}</span>
                    <button type="button" onClick={() => setFilter('all')} className="font-semibold text-emerald-700 underline">Show all</button>
                </div>
            )}

            {filtered.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                    {filter === 'all' ? 'Nothing coming up.' : 'Nothing ' + filterLabel + '.'}
                </div>
            ) : (
                <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
                    {/* The list. Hidden on mobile once a row is opened. */}
                    <div className={(mobileOpen ? 'hidden ' : '') + 'lg:block space-y-2'}>
                        {filtered.map((r) => {
                            const active = selected && r.id === selected.id;
                            return (
                                <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => { setSelectedId(r.id); setMobileOpen(true); }}
                                    className={'flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left transition hover:border-slate-300 '
                                        + (active ? 'border-emerald-600 ring-1 ring-emerald-600 lg:border-emerald-600' : 'border-slate-200')}
                                >
                                    <AvatarOverPhoto r={r} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            {r.needsReply && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Needs reply</span>}
                                            {r.soon && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">{r.soon}</span>}
                                            <span className="truncate text-[13px] text-slate-500">{r.whenLabel}</span>
                                        </div>
                                        <div className="mt-0.5 truncate text-sm font-semibold text-slate-900">{r.groupLabel}</div>
                                        <div className="truncate text-[13px] text-slate-500">{r.title}</div>
                                    </div>
                                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                </button>
                            );
                        })}
                    </div>

                    {/* The card. On mobile it replaces the list (with a back button). */}
                    {selected && (
                        <div className={(mobileOpen ? '' : 'hidden ') + 'lg:block'}>
                            <button type="button" onClick={() => setMobileOpen(false)} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 lg:hidden">
                                <ArrowLeft className="h-4 w-4" /> All reservations
                            </button>
                            <ReservationCard r={selected} />
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

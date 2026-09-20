'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { UserPlus, User, Check, Copy, X } from 'lucide-react';
import { getImageUrl, displayName } from '@/lib/utils';

// Who's going to a booked experience — the same invite MACHINE the cottage side
// uses (booking_guests seats, single-use /trip-invite links, the /api/booking-guests
// route), driving a small inline block that fits the order page rather than the
// trips card's portal sheet.
//
// The list is the order's own: seats keyed on the order, capped at the places
// booked minus the booker's. When the order is attached to a stay the picker
// prefills the people already on that booking as tappable names — a convenience,
// not the mechanism. With no stay it's a plain invite by email.
//
// A companion sees this READ-ONLY (faces, no controls) and, by the page's money
// wall, never the price.

interface Seat {
    id: string;
    user_id: string | null;
    name: string | null;
    email: string | null;
    status: string;
    invite_token: string | null;
}
interface Profile { id: string; avatar_url: string | null; full_name: string | null; preferred_name: string | null; show_full_name: boolean | null; }
interface Prefill { user_id: string; name: string; avatar_url: string | null; }

function avatarSrc(url: string | null | undefined): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : getImageUrl(url);
}

function Face({ name, photo, muted = false }: { name: string; photo: string | null; muted?: boolean }) {
    if (photo) return <img src={photo} alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-2 ring-white" />;
    if (muted) return <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-400 ring-2 ring-white"><User className="h-4 w-4" /></span>;
    return <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 ring-2 ring-white">{(name || '?').slice(0, 1).toUpperCase()}</span>;
}

export default function ExperienceGroup({
    orderId,
    bookerName,
    bookerAvatar,
    attendees,
    prefill = [],
    readOnly = false,
    initialSeats = [],
    initialProfiles = {},
}: {
    orderId: string;
    bookerName: string;
    bookerAvatar: string | null;
    attendees: number;
    prefill?: Prefill[];
    readOnly?: boolean;
    initialSeats?: Seat[];
    initialProfiles?: Record<string, Profile>;
}) {
    const [seats, setSeats] = useState<Seat[]>(initialSeats);
    const [profiles, setProfiles] = useState<Record<string, Profile>>(initialProfiles);
    const [busy, setBusy] = useState(false);
    const [email, setEmail] = useState('');
    const [copied, setCopied] = useState<string | null>(null);

    const cap = Math.max(0, (attendees || 1) - 1);

    // Every order mutation returns the fresh seats + profiles (the route reads
    // them as the service role). The block updates from that response — it never
    // reads booking_guests directly, because service_orders isn't authenticated-
    // readable, so an RLS read from the browser would come back empty.
    const apply = (data: any) => {
        if (data && Array.isArray(data.seats)) setSeats(data.seats as Seat[]);
        if (data && data.profiles) setProfiles(data.profiles as Record<string, Profile>);
    };

    useEffect(() => {
        if (readOnly) return;
        (async () => {
            // Mint this order's seats (idempotent, capped) and take the list back.
            const res = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'ensure-seats', orderId }),
            }).catch(() => null);
            if (res) { try { apply(await res.json()); } catch { /* ignore */ } }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId]);

    const active = seats.filter((s) => s.status === 'active');
    const empty = seats.filter((s) => s.status !== 'active');
    const nextEmpty = empty[0] || null;
    // Whom the picker can still offer: people on the stay not already seated here.
    const seatedIds = new Set(active.map((s) => s.user_id).filter(Boolean) as string[]);
    const offerable = prefill.filter((p) => !seatedIds.has(p.user_id));

    const nameOf = (s: Seat) => {
        const prof = s.user_id ? profiles[s.user_id] : undefined;
        return (prof && displayName(prof, '')) || s.name || s.email || 'Guest';
    };
    const linkFor = (s: Seat) => (typeof window !== 'undefined' ? window.location.origin : '') + '/trip-invite/' + (s.invite_token || '');

    const attachKnown = async (person: Prefill) => {
        if (!nextEmpty) return;
        setBusy(true);
        try {
            const res = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'attach-known', guestId: nextEmpty.id, userId: person.user_id }),
            });
            const data = await res.json();
            if (data && data.ok) apply(data);
            else toast.error((data && data.error) || 'Could not add them.', { theme: 'colored' });
        } finally { setBusy(false); }
    };

    const inviteByEmail = async () => {
        const addr = email.trim().toLowerCase();
        if (!addr || !nextEmpty) return;
        setBusy(true);
        try {
            // Bind the seat to the address, then hand back its single-use link to
            // copy. The label action pre-points the seat at an existing account.
            const label = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'label', guestId: nextEmpty.id, email: addr }),
            });
            const ld = await label.json();
            if (!ld || !ld.ok) { toast.error((ld && ld.error) || 'Could not set that up.', { theme: 'colored' }); return; }
            await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mark-sent', guestId: nextEmpty.id }),
            }).catch(() => {});
            try {
                await navigator.clipboard.writeText(linkFor(nextEmpty));
                setCopied(nextEmpty.id); setTimeout(() => setCopied(null), 2000);
                toast.success('Invite link copied — send it to ' + addr + '.', { theme: 'colored' });
            } catch {
                toast.info('Seat ready for ' + addr + ' — use Copy link to send it.', { theme: 'colored' });
            }
            setEmail('');
            apply(ld);
        } finally { setBusy(false); }
    };

    const copyLink = async (s: Seat) => {
        try {
            await navigator.clipboard.writeText(linkFor(s));
            setCopied(s.id); setTimeout(() => setCopied(null), 2000);
            await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'mark-sent', guestId: s.id }),
            }).catch(() => {});
        } catch { toast.error('Couldn’t copy the link.', { theme: 'colored' }); }
    };

    const remove = async (s: Seat) => {
        const who = s.status === 'active' ? nameOf(s) : 'this invite';
        if (!confirm('Take ' + who + ' off this experience? Their link stops working and the place opens up.')) return;
        setBusy(true);
        try {
            const res = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', guestId: s.id }),
            });
            const data = await res.json();
            if (data && data.ok) apply(data);
            else toast.error('Could not do that.', { theme: 'colored' });
        } finally { setBusy(false); }
    };

    // The faces: the booker always, then anyone who's accepted, then grey seats
    // for the places still open. A companion sees exactly this and nothing else.
    const faces = (
        <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
                <Face name={bookerName} photo={avatarSrc(bookerAvatar)} />
                <span className="text-sm text-slate-700">{readOnly ? bookerName : 'You'}<span className="text-slate-400"> · booked it</span></span>
            </div>
            {active.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                    <Face name={nameOf(s)} photo={avatarSrc(s.user_id ? profiles[s.user_id]?.avatar_url : null)} />
                    <span className="text-sm text-slate-700">{nameOf(s)}</span>
                    {!readOnly && (
                        <button type="button" onClick={() => remove(s)} aria-label={'Remove ' + nameOf(s)} className="text-slate-300 hover:text-rose-600"><X className="h-4 w-4" /></button>
                    )}
                </div>
            ))}
            {!readOnly && empty.map((s) => (
                <div key={s.id} className="flex items-center gap-2 opacity-70">
                    <Face name="" photo={null} muted />
                    <span className="text-sm text-slate-400">Open place</span>
                </div>
            ))}
        </div>
    );

    if (readOnly) {
        return (
            <div>
                {faces}
                {active.length === 0 && (
                    <p className="mt-2 text-sm text-slate-500">You’re going to this one.</p>
                )}
            </div>
        );
    }

    const full = active.length >= cap;

    return (
        <div>
            {faces}

            {cap === 0 ? (
                <p className="mt-3 text-sm text-slate-500">This is a single place, so it’s just you.</p>
            ) : full ? (
                <p className="mt-3 text-sm text-slate-500">Every place is taken — {active.length} of you going.</p>
            ) : (
                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <UserPlus className="h-4 w-4 text-slate-400" />
                        Invite someone — {cap - active.length} {cap - active.length === 1 ? 'place' : 'places'} left of the {attendees} you booked
                    </div>

                    {offerable.length > 0 && (
                        <div className="mt-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">On your trip</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {offerable.map((p) => (
                                    <button
                                        key={p.user_id}
                                        type="button"
                                        disabled={busy}
                                        onClick={() => attachKnown(p)}
                                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                                    >
                                        <Face name={p.name} photo={avatarSrc(p.avatar_url)} />
                                        {p.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{offerable.length > 0 ? 'Or by email' : 'By email'}</div>
                        <div className="mt-2 flex gap-2">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="their@email.com"
                                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                            />
                            <button
                                type="button"
                                disabled={busy || !email.trim()}
                                onClick={inviteByEmail}
                                className="flex-none rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                            >
                                Invite
                            </button>
                        </div>
                    </div>

                    {/* A bound-but-unaccepted seat carries a link to copy again. */}
                    {empty.some((s) => s.email) && (
                        <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3">
                            {empty.filter((s) => s.email).map((s) => (
                                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="min-w-0 truncate text-slate-600">Invited {s.email} — not joined yet</span>
                                    <span className="flex flex-none items-center gap-2">
                                        <button type="button" onClick={() => copyLink(s)} className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900">
                                            {copied === s.id ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
                                        </button>
                                        <button type="button" onClick={() => remove(s)} aria-label="Cancel invite" className="text-slate-300 hover:text-rose-600"><X className="h-4 w-4" /></button>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

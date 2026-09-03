'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { UserPlus, X, User, Link2, Mail, MessageCircle, Check } from 'lucide-react';

interface Companion {
    id: string;
    email: string;
    name: string | null;
    status: string;
    user_id: string | null;
    invite_token: string | null;
}

// The group coming on a trip, shown on the card the way Airbnb shows it — stacked
// avatars under the stay details, so a group booking looks like a group booking
// before you open anything. Accepted companions carry their initials; the seats
// nobody has claimed yet are grey silhouettes, so an empty seat reads as
// something to fill. Opening it gives the booker a sheet to add people and share
// each person's link four ways.
//
// The invite is bound to an email (see /api/booking-guests): the link only lets
// the person it was sent to in, because the trip reveals the address, the door
// code and the wifi. So a "share" is a per-person link delivered however suits —
// copied, emailed, texted or WhatsApp'd — not one open link for a group chat.

const PALETTE = ['bg-emerald-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-teal-600'];

function initials(nameOrEmail: string): string {
    const s = (nameOrEmail || '').trim();
    if (!s) return '?';
    const at = s.indexOf('@');
    const base = at > 0 ? s.slice(0, at) : s;
    const words = base.split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return base.slice(0, 2).toUpperCase();
}

function colorFor(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

function Avatar({ person }: { person: Companion }) {
    const label = person.name || person.email;
    const pending = person.status !== 'active';
    return (
        <div
            title={label + (pending ? ' — invited' : '')}
            className={
                'flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white ' +
                colorFor(person.email || label) + (pending ? ' opacity-60' : '')
            }
        >
            {initials(label)}
        </div>
    );
}

function EmptySeat() {
    return (
        <div
            title="Guest — a spot to fill"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-400 ring-2 ring-white"
        >
            <User className="h-4 w-4" />
        </div>
    );
}

export default function TripGroup({
    bookingId,
    guests,
    cottage,
    when,
}: {
    bookingId: string;
    guests?: number | null;
    cottage?: string;
    when?: string;
}) {
    const supabase = createClientComponentClient();
    const [people, setPeople] = useState<Companion[]>([]);
    const [loading, setLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [sending, setSending] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    useEffect(() => { setMounted(true); }, []);

    const load = async () => {
        const { data } = await supabase
            .from('booking_guests')
            .select('id, email, name, status, user_id, invite_token')
            .eq('booking_id', bookingId)
            .neq('status', 'removed')
            .order('invited_at');
        setPeople(data || []);
        setLoading(false);
    };
    useEffect(() => { load(); }, [bookingId]);

    // Party size minus the booker minus everyone already added = seats to fill.
    const party = guests && guests > 0 ? guests : null;
    const emptySeats = party ? Math.max(0, party - 1 - people.length) : 0;

    const going = people.filter((p) => p.status === 'active').length;
    const invited = people.filter((p) => p.status !== 'active').length;

    const linkFor = (p: Companion) =>
        (typeof window !== 'undefined' ? window.location.origin : '') + '/trip-invite/' + (p.invite_token || '');

    const shareText = (p: Companion) => {
        const who = cottage ? cottage : 'the cottage';
        const bit = when ? ', ' + when : '';
        return `Come to ${who}${bit} — I've added you to the trip. Join here (sign in with ${p.email}): ${linkFor(p)}`;
    };

    const invite = async () => {
        if (!email.trim()) { toast.error('Enter their email address.', { theme: 'colored' }); return; }
        setSending(true);
        try {
            const res = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'invite', bookingId, email: email.trim(), name: name.trim() }),
            });
            const data = await res.json();
            if (data && data.ok) {
                setEmail(''); setName('');
                await load();
                toast.success('Added — now send them the link below.', { theme: 'colored' });
            } else {
                toast.error((data && data.error) || 'Could not add them.', { theme: 'colored' });
            }
        } catch { toast.error('Could not add them.', { theme: 'colored' }); }
        setSending(false);
    };

    const remove = async (p: Companion) => {
        if (!confirm('Take ' + (p.name || p.email) + ' off this trip?')) return;
        const res = await fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', guestId: p.id }),
        });
        const data = await res.json();
        if (data && data.ok) load(); else toast.error('Could not do that.', { theme: 'colored' });
    };

    const copyLink = async (p: Companion) => {
        try {
            await navigator.clipboard.writeText(linkFor(p));
            setCopiedId(p.id); setTimeout(() => setCopiedId(null), 1500);
        } catch { toast.error('Could not copy the link.', { theme: 'colored' }); }
    };

    const emailInvite = async (p: Companion) => {
        const res = await fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'email', guestId: p.id }),
        });
        const data = await res.json();
        if (data && data.ok) toast.success('Email sent to ' + p.email + '.', { theme: 'colored' });
        else toast.error('Could not send the email.', { theme: 'colored' });
    };

    if (loading) return null;

    const nothingYet = people.length === 0 && emptySeats === 0;

    // The stacked row under the stay details. Even with nobody added, an invite
    // affordance shows so the booker can start.
    const shown = people.slice(0, 5);
    const overflow = people.length - shown.length;

    return (
        <div className="mt-3">
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-1 py-1 text-left transition hover:border-slate-200 hover:bg-slate-50"
            >
                <div className="flex items-center">
                    {/* The booker, always first. */}
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white ring-2 ring-white">
                        You
                    </div>
                    <div className="flex -space-x-2 pl-1">
                        {shown.map((p) => <Avatar key={p.id} person={p} />)}
                        {Array.from({ length: Math.min(emptySeats, overflow > 0 ? 0 : 6 - shown.length) }).map((_, i) => (
                            <EmptySeat key={'e' + i} />
                        ))}
                        {overflow > 0 && (
                            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-2 ring-white">
                                +{overflow}
                            </div>
                        )}
                    </div>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">
                        {nothingYet
                            ? 'Add the people coming with you'
                            : going + invited === 0
                                ? (emptySeats === 1 ? '1 spot to fill' : emptySeats + ' spots to fill')
                                : 'You' + (going ? ' and ' + going + ' going' : '')
                                    + (invited ? ' · ' + invited + ' invited' : '')
                                    + (emptySeats ? ' · ' + emptySeats + ' to fill' : '')}
                    </div>
                    <div className="text-xs text-slate-500 group-hover:text-slate-700">
                        {nothingYet ? 'They get the address, door code and wifi — not the price.' : 'Manage the group'}
                    </div>
                </div>
                <UserPlus className="h-4 w-4 flex-none text-slate-400 group-hover:text-slate-700" />
            </button>

            {open && mounted && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={() => setOpen(false)}>
                    <div
                        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-1 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-900">Your group</h2>
                            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>
                        <p className="mb-4 text-sm text-slate-500">
                            Add the people coming with you. Each gets their own link — copy it, email it,
                            or send it on Messages or WhatsApp.
                        </p>

                        {/* Who's on it */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">You</div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-slate-900">You</div>
                                    <div className="text-xs text-slate-500">You booked this stay</div>
                                </div>
                            </div>

                            {people.map((p) => (
                                <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                                    <div className="flex items-center gap-3">
                                        <Avatar person={p} />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-slate-900">{p.name || p.email}</div>
                                            <div className="text-xs">
                                                {p.status === 'active'
                                                    ? <span className="text-emerald-700">Going</span>
                                                    : <span className="text-amber-700">Invited — not joined yet</span>}
                                                {p.name && <span className="text-slate-400"> · {p.email}</span>}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => remove(p)} title="Take them off this trip" className="flex-none text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                                    </div>
                                    {p.status !== 'active' && p.invite_token && (
                                        <div className="mt-2.5 grid grid-cols-2 gap-2">
                                            <button type="button" onClick={() => copyLink(p)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400">
                                                {copiedId === p.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />} {copiedId === p.id ? 'Copied' : 'Copy link'}
                                            </button>
                                            <button type="button" onClick={() => emailInvite(p)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400">
                                                <Mail className="h-3.5 w-3.5" /> Email
                                            </button>
                                            <a href={'sms:?&body=' + encodeURIComponent(shareText(p))} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400">
                                                <MessageCircle className="h-3.5 w-3.5" /> Messages
                                            </a>
                                            <a href={'https://wa.me/?text=' + encodeURIComponent(shareText(p))} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400">
                                                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                                            </a>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {emptySeats > 0 && (
                                <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 p-3 text-slate-400">
                                    <EmptySeat />
                                    <div className="text-sm">{emptySeats === 1 ? '1 more spot on this booking' : emptySeats + ' more spots on this booking'}</div>
                                </div>
                            )}
                        </div>

                        {/* Add someone */}
                        <div className="mt-4 rounded-xl bg-slate-50 p-3">
                            <div className="text-sm font-semibold text-slate-900 mb-2">Add someone</div>
                            <div className="space-y-2">
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name (optional)" className="w-full rounded-lg border p-2.5 text-sm" />
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their@email.com" className="w-full rounded-lg border p-2.5 text-sm" />
                                <button type="button" onClick={invite} disabled={sending} className="w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                                    {sending ? 'Adding…' : 'Add to the trip'}
                                </button>
                                <p className="text-[11px] text-slate-500">
                                    The link only works for the email you enter — they sign in with it to join.
                                </p>
                            </div>
                        </div>

                        {/* What they'll see — plainly, because it includes the secrets */}
                        <div className="mt-4 rounded-xl border border-slate-200 p-3">
                            <div className="text-sm font-semibold text-slate-900 mb-1.5">What they'll be able to see</div>
                            <ul className="space-y-1 text-sm text-slate-700">
                                <li>Where the cottage is, and directions to the door</li>
                                <li>Check-in and checkout times, parking and arrival notes</li>
                                <li><strong>The door code and the wifi password</strong>, close to arrival</li>
                                <li>The host's number, and a way to message them</li>
                            </ul>
                            <p className="mt-2 text-sm text-slate-500">
                                They won't see what you paid, and can't change or cancel the booking.
                            </p>
                            <p className="mt-2 text-xs text-amber-700">
                                Anyone you add can reach the door code and wifi — add people you'd hand a key to.
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

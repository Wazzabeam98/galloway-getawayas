'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { UserPlus, X, User, Link2, Mail, MessageSquare, Check, RefreshCw } from 'lucide-react';
import { getImageUrl, displayName } from '@/lib/utils';

// The group coming on a trip, the way Airbnb shows it — the whole party the
// moment the sheet opens, no adding first. You at the top, then one row for
// every other place on the booking. A seat nobody has claimed is a grey "Guest"
// with a Remove on the right and nothing else: copying a link does not make
// anyone a guest, so an unclaimed seat looks the same whether or not its link
// has gone out. Only when someone actually accepts does the row become their
// name and photo.
//
// Every unclaimed seat still carries its own single-use link, minted when the
// sheet opens (see /api/booking-guests action=ensure-seats). "Invite guests" at
// the foot walks through the seats whose link has not gone out yet — that gate
// still reads link_sent_at, we just no longer show it on the row.
//
// The link is SINGLE-USE: whoever opens an unclaimed link claims that one seat,
// the link then dies, and it expires when the stay ends.

interface Companion {
    id: string;
    email: string | null;
    name: string | null;
    status: string;
    user_id: string | null;
    invite_token: string | null;
    link_sent_at: string | null;
}

interface Profile {
    id: string;
    avatar_url: string | null;
    full_name: string | null;
    preferred_name: string | null;
    show_full_name: boolean | null;
}

// Three states are tracked internally — 'unshared' vs 'shared' drives the
// invite gate at the foot — but the row only cares whether it is 'accepted'.
type SeatState = 'accepted' | 'shared' | 'unshared';

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

function avatarSrc(url: string | null | undefined): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : getImageUrl(url);
}

function EmptySeat({ size = 'md' }: { size?: 'sm' | 'md' }) {
    const dim = size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
    return (
        <div className={'flex flex-none items-center justify-center rounded-full bg-slate-200 text-slate-400 ring-2 ring-white ' + dim}>
            <User className="h-4 w-4" />
        </div>
    );
}

function WhatsAppIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
        </svg>
    );
}

function MessengerIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.19.16.14.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.99-.88c.17-.07.36-.09.54-.04 1.03.28 2.13.44 3.28.44 5.64 0 10-4.13 10-9.7C22.79 6.13 17.64 2 12 2Zm6 7.46-2.93 4.65c-.47.74-1.47.92-2.17.4l-2.33-1.75a.6.6 0 0 0-.72 0l-3.15 2.39c-.42.32-.97-.18-.69-.63l2.93-4.65c.47-.74 1.47-.92 2.17-.4l2.33 1.75c.21.16.51.16.72 0l3.15-2.39c.42-.32.97.18.69.63Z" />
        </svg>
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
    const [profiles, setProfiles] = useState<Record<string, Profile>>({});
    const [loading, setLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [shareOpen, setShareOpen] = useState(false);
    const [shareId, setShareId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => { setMounted(true); }, []);

    const load = async () => {
        const { data } = await supabase
            .from('booking_guests')
            .select('id, email, name, status, user_id, invite_token, link_sent_at')
            .eq('booking_id', bookingId)
            .neq('status', 'removed')
            .order('invited_at');
        const rows = (data as Companion[]) || [];
        setPeople(rows);

        const ids = rows.filter((p) => p.user_id).map((p) => p.user_id as string);
        if (ids.length) {
            const { data: profRows } = await supabase
                .from('profiles')
                .select('id, avatar_url, full_name, preferred_name, show_full_name')
                .in('id', ids);
            const map: Record<string, Profile> = {};
            (profRows as Profile[] | null)?.forEach((p) => { map[p.id] = p; });
            setProfiles(map);
        } else {
            setProfiles({});
        }
        setLoading(false);
    };

    // The card reads without minting anything — only OPENING the sheet fills the
    // seats, so browsing the trips list never creates links.
    useEffect(() => { load(); }, [bookingId]);

    const openSheet = async () => {
        setOpen(true);
        // Fill the party out to one seat per place, each with a link ready.
        await fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ensure-seats', bookingId }),
        }).catch(() => {});
        await load();
    };

    // Internal only. link_sent_at still separates a seat whose link has gone out
    // ('shared') from one whose has not ('unshared') so the invite gate below
    // knows what to hand out next — but neither shows on the row.
    const seatState = (p: Companion): SeatState =>
        p.status === 'active' ? 'accepted' : p.link_sent_at ? 'shared' : 'unshared';

    const nameOf = (p: Companion) => {
        if (seatState(p) === 'accepted') {
            const prof = p.user_id ? profiles[p.user_id] : undefined;
            return (prof && displayName(prof, '')) || p.name || p.email || 'Guest';
        }
        return 'Guest';
    };

    const linkFor = (p: Companion) =>
        (typeof window !== 'undefined' ? window.location.origin : '') + '/trip-invite/' + (p.invite_token || '');

    const shareText = (p: Companion) => {
        const who = cottage ? cottage : 'the cottage';
        const bit = when ? ', ' + when : '';
        return `Come to ${who}${bit} — I've added you to the trip. Join here: ${linkFor(p)}`;
    };

    // Handing a link out marks the seat 'shared', which is what closes the gate
    // on it — tracked, never shown.
    const markSent = (p: Companion) => {
        fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark-sent', guestId: p.id }),
        }).then(() => load()).catch(() => {});
    };

    const copyLink = async (p: Companion) => {
        try {
            await navigator.clipboard.writeText(linkFor(p));
            setCopiedId(p.id); setTimeout(() => setCopiedId(null), 1500);
            markSent(p);
        } catch { toast.error('Could not copy the link.', { theme: 'colored' }); }
    };

    const emailInvite = async (p: Companion) => {
        if (p.email) {
            const res = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'email', guestId: p.id }),
            });
            const data = await res.json();
            if (data && data.ok) { toast.success('Emailed to ' + p.email + '.', { theme: 'colored' }); load(); }
            else toast.error('Could not send the email.', { theme: 'colored' });
        } else {
            const subject = encodeURIComponent('Join my trip' + (cottage ? ' to ' + cottage : ''));
            window.location.href = 'mailto:?subject=' + subject + '&body=' + encodeURIComponent(shareText(p));
            markSent(p);
        }
    };

    // A new link — the exception, not re-share. copyLink and ShareTiles all act
    // on the seat's EXISTING invite_token, so re-sharing never changes the link;
    // this is only for when the booker explicitly wants a fresh one (a leaked
    // link), and it invalidates the old.
    const regenerate = async (p: Companion) => {
        if (!confirm('Make a NEW link for this seat? The current link stops working — only do this if the old one leaked.')) return;
        setBusyId(p.id);
        try {
            const res = await fetch('/api/booking-guests', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'regenerate', guestId: p.id }),
            });
            const data = await res.json();
            if (data && data.ok) { await load(); } else toast.error('Could not make a new link.', { theme: 'colored' });
        } finally { setBusyId(null); }
    };

    const remove = async (p: Companion) => {
        const who = seatState(p) === 'accepted' ? nameOf(p) : 'this guest';
        if (!confirm('Take ' + who + ' off this trip? The seat opens up again and their link stops working.')) return;
        const res = await fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', guestId: p.id }),
        });
        const data = await res.json();
        if (data && data.ok) { load(); } else toast.error('Could not do that.', { theme: 'colored' });
    };

    if (loading && !open) return null;

    // Card summary numbers. A shared link does not count as anyone joining, so
    // everyone who has not accepted is simply a seat "to fill".
    const going = people.filter((p) => seatState(p) === 'accepted').length;
    const toFill = people.length - going;
    // Seats whose link has not gone out yet — what "Invite guests" hands out next.
    const unsharedN = people.filter((p) => seatState(p) === 'unshared').length;

    // Before the sheet has ever been opened the seats aren't rows yet, so the
    // card still fills the stack from the party size.
    const party = guests && guests > 0 ? guests : null;
    const emptySeats = party ? Math.max(0, party - 1 - people.length) : 0;
    const nothingYet = people.length === 0 && emptySeats === 0;
    const openLabelN = emptySeats || toFill;

    const nextUnshared = people.find((p) => seatState(p) === 'unshared') || null;

    const Avatar = ({ p, size = 'md' }: { p: Companion; size?: 'sm' | 'md' }) => {
        // Only an accepted seat shows a real identity. Everything else is a grey
        // silhouette, shared link or not.
        if (seatState(p) !== 'accepted') return <EmptySeat size={size} />;
        const prof = p.user_id ? profiles[p.user_id] : undefined;
        const photo = avatarSrc(prof && prof.avatar_url);
        const dim = size === 'sm' ? 'h-9 w-9 text-xs' : 'h-10 w-10 text-sm';
        if (photo) return <img src={photo} alt="" className={'flex-none rounded-full object-cover ring-2 ring-white ' + dim} />;
        return (
            <div className={'flex flex-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-white ' + dim + ' ' + colorFor(p.email || nameOf(p))}>
                {initials(nameOf(p))}
            </div>
        );
    };

    const stackShown = people.slice(0, 5);
    const overflow = people.length - stackShown.length;

    // The five share tiles, acting on one seat's link.
    // A compact 2×3 grid the way Airbnb shares — five channels as roomy targets
    // inside the box, rather than five thin tiles stretched across the bottom.
    const ShareTiles = ({ p }: { p: Companion }) => {
        const tile = 'flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50';
        return (
            <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => copyLink(p)} className={tile}>
                    {copiedId === p.id ? <Check className="h-5 w-5 flex-none text-emerald-600" /> : <Link2 className="h-5 w-5 flex-none" />}
                    {copiedId === p.id ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" onClick={() => emailInvite(p)} className={tile}><Mail className="h-5 w-5 flex-none" /> Email</button>
                <a href={'sms:?&body=' + encodeURIComponent(shareText(p))} onClick={() => markSent(p)} className={tile}><MessageSquare className="h-5 w-5 flex-none" /> Messages</a>
                <a href={'https://wa.me/?text=' + encodeURIComponent(shareText(p))} target="_blank" rel="noreferrer" onClick={() => markSent(p)} className={tile}><WhatsAppIcon className="h-5 w-5 flex-none" /> WhatsApp</a>
                <a href={'fb-messenger://share/?link=' + encodeURIComponent(linkFor(p))} onClick={() => markSent(p)} className={tile}><MessengerIcon className="h-5 w-5 flex-none" /> Messenger</a>
            </div>
        );
    };

    return (
        <div className="mt-3">
            <button
                type="button"
                onClick={openSheet}
                className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-1 py-1 text-left transition hover:border-slate-200 hover:bg-slate-50"
            >
                <div className="flex items-center">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white ring-2 ring-white">You</div>
                    <div className="flex -space-x-2 pl-1">
                        {stackShown.map((p) => <Avatar key={p.id} p={p} size="sm" />)}
                        {Array.from({ length: Math.min(emptySeats, overflow > 0 ? 0 : 6 - stackShown.length) }).map((_, i) => (
                            <EmptySeat key={'e' + i} size="sm" />
                        ))}
                        {overflow > 0 && (
                            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-2 ring-white">+{overflow}</div>
                        )}
                    </div>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">
                        {nothingYet
                            ? 'Add the people coming with you'
                            : going === 0
                                ? (openLabelN === 1 ? '1 spot to fill' : openLabelN + ' spots to fill')
                                : 'You and ' + going + ' going' + (openLabelN ? ' · ' + openLabelN + ' to fill' : '')}
                    </div>
                    <div className="text-xs text-slate-500 group-hover:text-slate-700">
                        {nothingYet ? 'Share a link — no email needed.' : 'Manage the group'}
                    </div>
                </div>
                <UserPlus className="h-4 w-4 flex-none text-slate-400 group-hover:text-slate-700" />
            </button>

            {open && mounted && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={() => setOpen(false)}>
                    <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 pt-5">
                            <h2 className="text-lg font-bold text-slate-900">Your group</h2>
                            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>
                        <p className="px-5 pb-3 pt-1 text-sm text-slate-500">
                            Everyone on the booking. Invite an open seat with its link — no email needed.
                        </p>

                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5">
                            {/* You */}
                            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">You</div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-slate-900">You</div>
                                    <div className="text-xs text-slate-500">Booked this stay</div>
                                </div>
                                <span className="flex-none rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Booker</span>
                            </div>

                            {loading && people.length === 0 && (
                                <div className="py-6 text-center text-sm text-slate-400">Setting up the seats…</div>
                            )}

                            {/* One row per other seat. A guest is a plain grey seat with
                                Remove and nothing else; only an accepted seat carries a
                                name and photo. Rows are not clickable — like Airbnb,
                                tapping a guest does nothing. */}
                            {people.map((p) => {
                                const accepted = seatState(p) === 'accepted';
                                const sharing = shareId === p.id;
                                return (
                                    <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                                        <div className="flex items-center gap-3">
                                            <Avatar p={p} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-slate-900">{nameOf(p)}</div>
                                            </div>
                                            {/* Re-share sends the SAME link again — the message got lost,
                                                the link didn't. Small, so the row stays clean. */}
                                            {!accepted && (
                                                <button type="button" onClick={() => setShareId(sharing ? null : p.id)} className="flex-none text-xs font-medium text-slate-400 hover:text-slate-700">
                                                    {sharing ? 'Close' : 'Re-share'}
                                                </button>
                                            )}
                                            <button type="button" onClick={() => remove(p)} className="flex-none text-xs font-medium text-slate-400 hover:text-red-600">Remove</button>
                                        </div>
                                        {!accepted && sharing && (
                                            <div className="mt-3 border-t border-slate-100 pt-3">
                                                <p className="mb-2 text-xs text-slate-500">Send the same link again:</p>
                                                <ShareTiles p={p} />
                                                <button type="button" onClick={() => regenerate(p)} disabled={busyId === p.id} className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-700 disabled:opacity-50">
                                                    <RefreshCw className="h-3 w-3" /> {busyId === p.id ? 'Making a new link…' : 'Make a new link instead'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* What a companion sees — plain, because it's expected */}
                            <div className="rounded-xl bg-slate-50 p-3.5">
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">What a companion sees</div>
                                <p className="text-sm text-slate-600">
                                    The address and directions, check-in times and arrival notes, and — close to
                                    arrival — the door code and wifi, plus a way to message the host. Not the price,
                                    and they can't change or cancel the booking.
                                </p>
                            </div>
                        </div>

                        {/* Invite guests — the one share entry, at the foot. It walks
                            through the seats whose link has not gone out yet. */}
                        <div className="border-t border-slate-100 p-4">
                            {shareOpen && nextUnshared && (
                                <div className="mb-3">
                                    <div className="mb-2 text-xs font-medium text-slate-500">
                                        Sharing a link for an open seat{unsharedN > 1 ? ' · ' + unsharedN + ' open' : ''}
                                    </div>
                                    <ShareTiles p={nextUnshared} />
                                </div>
                            )}
                            {shareOpen && !nextUnshared && (
                                <p className="mb-3 text-xs text-slate-500">You've shared a link for every open seat.</p>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">{toFill ? (toFill === 1 ? '1 seat to fill' : toFill + ' seats to fill') : 'Everyone\'s in'}</span>
                                <button
                                    type="button"
                                    onClick={() => setShareOpen((v) => !v)}
                                    disabled={!nextUnshared && !shareOpen}
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                                >
                                    <UserPlus className="h-4 w-4" /> {shareOpen ? 'Done' : 'Invite guests'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

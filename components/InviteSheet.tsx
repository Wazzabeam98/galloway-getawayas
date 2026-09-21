'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { X, User, Link2, Mail, MessageSquare, Check, RefreshCw, UserPlus } from 'lucide-react';
import { getImageUrl, displayName } from '@/lib/utils';

// The invite sheet, shared by the holiday-let side (TripGroup) and the experience
// side (ExperienceGroup) so the flow is identical everywhere: the whole party the
// moment it opens, an unclaimed seat as a grey "Guest" with Remove, and one
// "Invite guests" entry at the foot that shares a single-use link through Copy,
// Email, Messages, WhatsApp or Messenger.
//
// It is presentation + the per-seat mutations, which are the SAME on both sides
// (every action keys on the seat's guestId through /api/booking-guests). What
// differs — how the seats are read (a booking is client-readable under RLS; an
// order is not, so it comes from the service-role route) — stays with the owner,
// which passes the seats in and a refetch() to call after a change.

export interface Seat {
    id: string;
    email: string | null;
    name: string | null;
    status: string;
    user_id: string | null;
    invite_token: string | null;
    link_sent_at: string | null;
}
export interface Profile {
    id: string;
    avatar_url: string | null;
    full_name: string | null;
    preferred_name: string | null;
    show_full_name: boolean | null;
}

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
function EmptySeat() {
    return (
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-400 ring-2 ring-white">
            <User className="h-4 w-4" />
        </div>
    );
}
function WhatsAppIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" /></svg>);
}
function MessengerIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.19.16.14.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.99-.88c.17-.07.36-.09.54-.04 1.03.28 2.13.44 3.28.44 5.64 0 10-4.13 10-9.7C22.79 6.13 17.64 2 12 2Zm6 7.46-2.93 4.65c-.47.74-1.47.92-2.17.4l-2.33-1.75a.6.6 0 0 0-.72 0l-3.15 2.39c-.42.32-.97-.18-.69-.63l2.93-4.65c.47-.74 1.47-.92 2.17-.4l2.33 1.75c.21.16.51.16.72 0l3.15-2.39c.42-.32.97.18.69.63Z" /></svg>);
}

export interface InviteContext {
    // What the guest is being invited to, for the share message and the header.
    place: string;         // "Harbour Cottage" / "Sweatflix and Chill"
    when?: string;         // "2 Oct, 4pm" (optional)
    noun: 'trip' | 'experience';
}

async function post(body: any) {
    const res = await fetch('/api/booking-guests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json().catch(() => ({ ok: false }));
}

export default function InviteSheet({
    open, onClose, context, people, profiles, loading, refetch,
}: {
    open: boolean;
    onClose: () => void;
    context: InviteContext;
    people: Seat[];
    profiles: Record<string, Profile>;
    loading: boolean;
    refetch: () => Promise<void>;
}) {
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copyErrorId, setCopyErrorId] = useState<string | null>(null);
    const [shareId, setShareId] = useState<string | null>(null);
    const [shareOpen, setShareOpen] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    if (typeof document === 'undefined' || !open) return null;

    const seatState = (p: Seat): SeatState => p.status === 'active' ? 'accepted' : p.link_sent_at ? 'shared' : 'unshared';
    const nameOf = (p: Seat) => {
        if (seatState(p) === 'accepted') {
            const prof = p.user_id ? profiles[p.user_id] : undefined;
            return (prof && displayName(prof, '')) || p.name || p.email || 'Guest';
        }
        return 'Guest';
    };
    const linkFor = (p: Seat) => (typeof window !== 'undefined' ? window.location.origin : '') + '/trip-invite/' + (p.invite_token || '');
    const shareText = (p: Seat) => {
        const dest = context.place || (context.noun === 'trip' ? 'the cottage' : 'the experience');
        const bit = context.when ? ', ' + context.when : '';
        const what = context.noun === 'trip' ? 'the trip' : 'this experience';
        return `Come to ${dest}${bit} — I've added you to ${what}. Join here: ${linkFor(p)}`;
    };

    const markSent = (p: Seat) => { post({ action: 'mark-sent', guestId: p.id }).then(refetch).catch(() => {}); };

    const copyLink = async (p: Seat) => {
        try {
            await navigator.clipboard.writeText(linkFor(p));
            setCopiedId(p.id); setTimeout(() => setCopiedId(null), 1500); setCopyErrorId(null);
            markSent(p);
        } catch {
            setCopyErrorId(p.id);
            toast.error('Couldn’t copy — the link is shown below, select and copy it by hand.', { theme: 'colored' });
        }
    };
    const emailInvite = async (p: Seat) => {
        if (p.email) {
            const d = await post({ action: 'email', guestId: p.id });
            if (d && d.ok) { toast.success('Emailed to ' + p.email + '.', { theme: 'colored' }); refetch(); }
            else toast.error('Could not send the email.', { theme: 'colored' });
        } else {
            const subject = encodeURIComponent('Join my ' + context.noun + (context.place ? ' — ' + context.place : ''));
            window.location.href = 'mailto:?subject=' + subject + '&body=' + encodeURIComponent(shareText(p));
        }
    };
    const regenerate = async (p: Seat) => {
        if (!confirm('Make a NEW link for this seat? The current link stops working — only do this if the old one leaked.')) return;
        setBusyId(p.id);
        try { const d = await post({ action: 'regenerate', guestId: p.id }); if (d && d.ok) await refetch(); else toast.error('Could not make a new link.', { theme: 'colored' }); }
        finally { setBusyId(null); }
    };
    const remove = async (p: Seat) => {
        const who = seatState(p) === 'accepted' ? nameOf(p) : 'this guest';
        if (!confirm('Take ' + who + ' off this ' + context.noun + '? The seat opens up again and their link stops working.')) return;
        const d = await post({ action: 'remove', guestId: p.id });
        if (d && d.ok) refetch(); else toast.error('Could not do that.', { theme: 'colored' });
    };

    const going = people.filter((p) => seatState(p) === 'accepted').length;
    const toFill = people.length - going;
    const unsharedN = people.filter((p) => seatState(p) === 'unshared').length;
    const nextUnshared = people.find((p) => seatState(p) === 'unshared') || null;

    const Avatar = ({ p }: { p: Seat }) => {
        if (seatState(p) !== 'accepted') return <EmptySeat />;
        const prof = p.user_id ? profiles[p.user_id] : undefined;
        const photo = avatarSrc(prof && prof.avatar_url);
        if (photo) return <img src={photo} alt="" className="h-10 w-10 flex-none rounded-full object-cover text-sm ring-2 ring-white" />;
        return <div className={'flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-white ' + colorFor(p.email || nameOf(p))}>{initials(nameOf(p))}</div>;
    };

    const ShareTiles = ({ p }: { p: Seat }) => {
        const tile = 'flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50';
        const copied = copiedId === p.id;
        const failed = copyErrorId === p.id;
        return (
            <div className="space-y-2">
                <button type="button" onClick={() => copyLink(p)}
                    className={'flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-white transition ' + (copied ? 'bg-emerald-600' : failed ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700')}>
                    {copied ? <Check className="h-5 w-5 flex-none" /> : failed ? <X className="h-5 w-5 flex-none" /> : <Link2 className="h-5 w-5 flex-none" />}
                    {copied ? 'Copied' : failed ? 'Couldn’t copy — copy it below' : 'Copy link'}
                </button>
                {failed && (
                    <input readOnly value={linkFor(p)} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()}
                        className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900" />
                )}
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => emailInvite(p)} className={tile}><Mail className="h-5 w-5 flex-none" /> Email</button>
                    <a href={'sms:?&body=' + encodeURIComponent(shareText(p))} className={tile}><MessageSquare className="h-5 w-5 flex-none" /> Messages</a>
                    <a href={'https://wa.me/?text=' + encodeURIComponent(shareText(p))} target="_blank" rel="noreferrer" className={tile}><WhatsAppIcon className="h-5 w-5 flex-none" /> WhatsApp</a>
                    <a href={'fb-messenger://share/?link=' + encodeURIComponent(linkFor(p))} className={tile}><MessengerIcon className="h-5 w-5 flex-none" /> Messenger</a>
                </div>
            </div>
        );
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={onClose}>
            <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 pt-5">
                    <h2 className="text-lg font-bold text-slate-900">Invite guests</h2>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                </div>
                <p className="px-5 pb-3 pt-1 text-sm text-slate-500">
                    Invite guests to join {context.noun === 'trip' ? 'your trip' : 'this experience'}{context.place ? ' at ' + context.place : ''}.
                </p>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5">
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">You</div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900">You</div>
                            <div className="text-xs text-slate-500">Booked this {context.noun === 'trip' ? 'stay' : 'experience'}</div>
                        </div>
                        <span className="flex-none rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Booker</span>
                    </div>

                    {loading && people.length === 0 && (<div className="py-6 text-center text-sm text-slate-400">Setting up the seats…</div>)}

                    {people.map((p) => {
                        const shared = seatState(p) === 'shared';
                        const sharing = shareId === p.id;
                        return (
                            <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                                <div className="flex items-center gap-3">
                                    <Avatar p={p} />
                                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-900">{nameOf(p)}</div></div>
                                    {shared && (<button type="button" onClick={() => setShareId(sharing ? null : p.id)} className="flex-none text-xs font-medium text-slate-400 hover:text-slate-700">{sharing ? 'Close' : 'Re-share'}</button>)}
                                    <button type="button" onClick={() => remove(p)} className="flex-none text-xs font-medium text-slate-400 hover:text-red-600">Remove</button>
                                </div>
                                {shared && sharing && (
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

                </div>

                <div className="border-t border-slate-100 p-4">
                    {shareOpen && nextUnshared && (
                        <div className="mb-3">
                            <div className="mb-2 text-xs font-medium text-slate-500">Sharing a link for an open seat{unsharedN > 1 ? ' · ' + unsharedN + ' open' : ''}</div>
                            <ShareTiles p={nextUnshared} />
                        </div>
                    )}
                    {shareOpen && !nextUnshared && (<p className="mb-3 text-xs text-slate-500">You've shared a link for every open seat.</p>)}
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{toFill ? (toFill === 1 ? '1 seat to fill' : toFill + ' seats to fill') : 'Everyone\'s in'}</span>
                        <button type="button" onClick={() => setShareOpen((v) => !v)} disabled={!nextUnshared && !shareOpen}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                            <UserPlus className="h-4 w-4" /> {shareOpen ? 'Done' : 'Invite guests'}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

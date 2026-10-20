'use client';

import { useEffect, useRef, useState } from 'react';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import { Archive, ArchiveRestore, Check, Home, Mail, MoreHorizontal, Star, Sparkles, Wrench } from 'lucide-react';

// One row in the inbox, with its own actions menu.
//
// This is one component used by both the desktop list and the phone list.
// The two used to be separate copies of the same markup, which was survivable
// while they were only displaying things; with three actions and a menu on
// each of them it would have meant building the same menu twice and fixing
// every bug in it twice.

function timeAgo(iso: string): string {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.round(hours / 24);
    return days + 'd ago';
}

// One face in the stack: their photo, else the first letter of their name on
// a plain disc, the way Airbnb shows someone with no photo.
function Face(props: { person: any; className: string }) {
    const p = props.person || {};
    return (
        <span
            className={
                'rounded-full ring-2 ring-white bg-slate-700 text-white overflow-hidden flex items-center justify-center font-semibold text-xs ' +
                props.className
            }
        >
            {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
                (String(p.name || '').trim().charAt(0) || '·').toUpperCase()
            )}
        </span>
    );
}

// Airbnb's stacked avatars: the place's photo, with the other person's face
// over its bottom-right corner and a co-host's beside it. With no photo of the
// place, the other person's face takes the whole spot instead.
function AvatarStack(props: { conversation: any }) {
    const c = props.conversation;
    const people: any[] = Array.isArray(c.people) ? c.people : [];
    const photo = c.photoUrl || (c.listing && c.listing.images && c.listing.images[0] ? getImageUrl(c.listing.images[0]) : null);

    if (!photo) {
        if (people[0]) {
            return (
                <div className="relative w-14 h-14 flex-shrink-0">
                    <Face person={people[0]} className="w-12 h-12 ring-0" />
                    {people[1] && <Face person={people[1]} className="absolute bottom-0 right-0 w-7 h-7" />}
                </div>
            );
        }
        const Icon = c.kind === 'order' ? Sparkles : c.kind === 'enquiry' ? Wrench : Home;
        return (
            <div className="w-12 h-12 rounded-xl bg-slate-200 flex-shrink-0 flex items-center justify-center">
                <Icon className="w-5 h-5 text-slate-400" />
            </div>
        );
    }

    return (
        <div className="relative w-14 h-14 flex-shrink-0">
            <div className="w-12 h-12 rounded-xl bg-slate-200 overflow-hidden">
                <img src={photo} alt="" className="w-full h-full object-cover" />
            </div>
            {people[1] && <Face person={people[1]} className="absolute bottom-0 right-5 w-7 h-7" />}
            {people[0] && <Face person={people[0]} className="absolute bottom-0 right-0 w-7 h-7" />}
        </div>
    );
}

// How long a finger has to stay down before the menu opens. Long enough not
// to fire while somebody is starting a scroll, short enough not to feel stuck.
const LONG_PRESS_MS = 500;

export default function ConversationRow(props: {
    conversation: any;
    active?: boolean;
    // The phone list has no selected row, so it does not want the highlight.
    showActive?: boolean;
    busy?: boolean;
    onOpen: () => void;
    onNoReplyNeeded: () => void;
    onStar: () => void;
    onArchive: () => void;
    onMarkUnread: () => void;
}) {
    const c = props.conversation;

    const [menuOpen, setMenuOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const pressTimer = useRef<any>(null);

    // Set when a long press has opened the menu, so the touch ending does not
    // also count as a tap and open the conversation underneath.
    const openedByPress = useRef(false);

    useEffect(() => {
        if (!menuOpen) return;

        const onDown = (e: MouseEvent | TouchEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };

        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);

        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    // A row that scrolls out from under an open menu leaves the menu behind.
    useEffect(() => {
        return () => {
            if (pressTimer.current) clearTimeout(pressTimer.current);
        };
    }, []);

    const cancelPress = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
    };

    const startPress = () => {
        // Star / archive / mark-unread exist only on booking threads (they live in
        // conversation_prefs, which the other kinds have no row in). No menu, and
        // no long-press to raise one, on an enquiry or order row.
        if (!c.manageable) return;
        cancelPress();
        openedByPress.current = false;
        pressTimer.current = setTimeout(() => {
            openedByPress.current = true;
            setMenuOpen(true);
        }, LONG_PRESS_MS);
    };

    const run = (fn: () => void) => {
        setMenuOpen(false);
        fn();
    };

    const actions = (
        <>
            {c.needsReply && (
                <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => run(props.onNoReplyNeeded)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2 text-sm text-left text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    <Check className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    No reply needed
                </button>
            )}

            <button
                type="button"
                disabled={props.busy}
                onClick={() => run(props.onMarkUnread)}
                className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2 text-sm text-left text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                Mark as unread
            </button>

            <button
                type="button"
                disabled={props.busy}
                onClick={() => run(props.onStar)}
                className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2 text-sm text-left text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
                <Star
                    className={
                        'w-4 h-4 flex-shrink-0 ' +
                        (c.starred ? 'text-amber-500 fill-amber-500' : 'text-slate-400')
                    }
                />
                {c.starred ? 'Remove star' : 'Star'}
            </button>

            <button
                type="button"
                disabled={props.busy}
                onClick={() => run(props.onArchive)}
                className="w-full flex items-center gap-2.5 px-4 py-3 sm:py-2 text-sm text-left text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
                {c.archived ? (
                    <ArchiveRestore className="w-4 h-4 text-slate-400 flex-shrink-0" />
                ) : (
                    <Archive className="w-4 h-4 text-slate-400 flex-shrink-0" />
                )}
                {c.archived ? 'Move to inbox' : 'Archive'}
            </button>
        </>
    );

    return (
        <div ref={wrapRef} className="relative group border-b">
            <button
                type="button"
                onClick={() => {
                    // The click that follows a long press is the finger coming
                    // off, not somebody choosing the conversation.
                    if (openedByPress.current) {
                        openedByPress.current = false;
                        return;
                    }
                    props.onOpen();
                }}
                onTouchStart={startPress}
                onTouchEnd={cancelPress}
                onTouchMove={cancelPress}
                onTouchCancel={cancelPress}
                onContextMenu={(e) => {
                    // Holding a finger down on a phone otherwise raises the
                    // browser's own text-selection menu over the top of ours.
                    if (openedByPress.current) e.preventDefault();
                }}
                className={
                    // select-none so a long press raises our menu rather than
                    // the phone's own text-selection handles.
                    'w-full text-left p-4 transition flex gap-3 select-none lg:select-auto ' +
                    (props.showActive && props.active
                        ? 'bg-slate-100'
                        : c.unread
                            ? 'bg-emerald-50/50 hover:bg-emerald-50'
                            : 'hover:bg-slate-50')
                }
            >
                <AvatarStack conversation={c} />

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {c.starred && (
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />
                        )}
                        <span className="font-semibold text-slate-900 truncate max-sm:text-lg">
                            {capitializeFirst(c.otherName)}
                        </span>
                        {c.unread > 0 && (
                            <span className="flex-shrink-0 text-xs font-bold text-white bg-emerald-700 rounded-full px-1.5">
                                {c.unread}
                            </span>
                        )}
                        {c.lastMessage && (
                            // Room kept clear on the right for the three dots,
                            // so a long name does not run underneath them.
                            <span className="ml-auto text-xs text-slate-500 flex-shrink-0 pr-6 max-sm:text-[15px] max-sm:text-slate-600">
                                {timeAgo(c.lastMessage.created_at)}
                            </span>
                        )}
                    </div>

                    {/* What it is about and where it has got to — "Confirmed ·
                        19–22 Dec" — then the place, as Airbnb's inbox writes it. */}
                    <div className="text-xs text-slate-500 truncate mt-0.5 max-sm:text-base max-sm:text-slate-600">
                        {[c.statusLine, c.placeTitle || (c.listing && c.listing.title) || c.subtitle]
                            .filter(Boolean)
                            .join(' · ')}
                    </div>

                    {c.lastMessage && (
                        <div
                            className={
                                // On a phone the preview matches the Airbnb app:
                                // 17px, near-black (slate-800), and bold + darkest
                                // (slate-900) when unread. Desktop keeps its own
                                // size/colour; the phone changes are max-sm: only.
                                'text-sm truncate mt-1 max-sm:text-[17px] ' +
                                (c.unread > 0
                                    ? 'text-slate-900 font-semibold'
                                    : c.needsReply
                                        ? 'text-slate-700 font-medium max-sm:text-slate-800'
                                        : 'text-slate-500 max-sm:text-slate-800')
                            }
                        >
                            {c.needsReply && <span className="text-amber-600">&bull; </span>}
                            {/* Whose words these are: "You:" for your own, the
                                sender's first name for theirs. */}
                            {c.lastMessage.senderLabel && (
                                <span>{capitializeFirst(c.lastMessage.senderLabel)}: </span>
                            )}
                            {c.lastMessage.body}
                        </div>
                    )}
                </div>
            </button>

            {/* A sibling of the row rather than a child of it. A button inside
                a button is not allowed, and browsers deal with it by throwing
                the inner one out of the element entirely. */}
            {c.manageable && <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={'Actions for the conversation with ' + capitializeFirst(c.otherName)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={
                    'hidden lg:flex absolute top-2 right-2 w-7 h-7 items-center justify-center ' +
                    'rounded-lg text-slate-400 hover:text-slate-900 hover:bg-white ' +
                    'focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-slate-900 ' +
                    'transition-opacity ' +
                    // Kept in the layout at all times and only faded, so the
                    // row does not shuffle about as the pointer crosses it.
                    (menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
                }
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>}

            {c.manageable && menuOpen && (
                <>
                    {/* Desktop: a dropdown hanging off the dots. */}
                    <div
                        role="menu"
                        className="hidden lg:block absolute right-2 top-9 z-30 w-44 bg-white border rounded-xl shadow-lg overflow-hidden py-1"
                    >
                        {actions}
                    </div>

                    {/* Phone: the same three actions as a sheet at the bottom,
                        where a thumb can reach them. */}
                    <div className="lg:hidden">
                        <div
                            className="fixed inset-0 z-40 bg-slate-900/30"
                            onClick={() => setMenuOpen(false)}
                        />
                        <div
                            role="menu"
                            className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl pb-6 pt-2"
                        >
                            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-2" />
                            <div className="px-4 pb-2 text-xs font-semibold text-slate-400 truncate">
                                {capitializeFirst(c.otherName)}
                            </div>
                            {actions}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

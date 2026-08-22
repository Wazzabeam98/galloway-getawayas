'use client';

import { useEffect, useRef, useState } from 'react';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import { Archive, ArchiveRestore, Mail, MoreHorizontal, Star } from 'lucide-react';

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

const stageStyles: Record<string, string> = {
    staying: 'bg-emerald-100 text-emerald-800',
    upcoming: 'bg-sky-100 text-sky-800',
    past: 'bg-slate-100 text-slate-500',
};

const stageWords: Record<string, string> = {
    staying: 'Here now',
    upcoming: 'Upcoming',
    past: 'Past',
};

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
                <div className="w-12 h-12 rounded-xl bg-slate-200 overflow-hidden flex-shrink-0">
                    {c.listing && c.listing.images && c.listing.images[0] && (
                        <img
                            src={getImageUrl(c.listing.images[0])}
                            alt=""
                            className="w-full h-full object-cover"
                        />
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {c.starred && (
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />
                        )}
                        <span className="font-semibold text-slate-900 truncate">
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
                            <span className="ml-auto text-xs text-slate-400 flex-shrink-0 pr-6">
                                {timeAgo(c.lastMessage.created_at)}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                            className={
                                'text-[10px] font-semibold px-1.5 py-0.5 rounded ' +
                                (stageStyles[c.stage] || stageStyles.past)
                            }
                        >
                            {stageWords[c.stage] || 'Past'}
                        </span>
                        <span className="text-xs text-slate-500 truncate">
                            {(c.listing && c.listing.title) || 'Listing'}
                        </span>
                    </div>

                    {c.lastMessage && (
                        <div
                            className={
                                'text-xs truncate mt-1 ' +
                                (c.needsReply ? 'text-slate-900 font-medium' : 'text-slate-400')
                            }
                        >
                            {c.needsReply && <span className="text-amber-600">&bull; </span>}
                            {c.lastMessage.body}
                        </div>
                    )}
                </div>
            </button>

            {/* A sibling of the row rather than a child of it. A button inside
                a button is not allowed, and browsers deal with it by throwing
                the inner one out of the element entirely. */}
            <button
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
            </button>

            {menuOpen && (
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

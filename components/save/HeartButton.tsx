'use client';

import { useState, useEffect } from 'react';
import { openAuthPanel } from '@/components/auth/AuthPanel';
import { useSaved, isSaved, removeSaved, type SavedKind } from '@/lib/savedStore';
import SaveSheet from '@/components/save/SaveSheet';

// The heart on a card, and the "Save" button on a listing/experience page.
// Saved state loads on the client (never baked into the cached page). Tapping it
// signed-out opens sign-in and returns to the item's page with the save intent;
// signed-in, a filled heart unsaves, an empty heart opens the Save sheet.
export default function HeartButton({
    kind,
    id,
    href,
    variant = 'card',
    autoOpen = false,
    className,
}: {
    kind: SavedKind;
    id: string;
    href: string;      // the item's detail page, used to resume a save after sign-in
    // 'card' — the small round heart over a listing card. 'button' — the text
    // "Save" in a page's top-right row (desktop). 'overlay' — a round white icon
    // button over the photo on a mobile listing page (Airbnb's mobile pattern).
    variant?: 'card' | 'button' | 'overlay';
    autoOpen?: boolean; // open the Save sheet on mount (the ?save=1 resume)
    className?: string;
}) {
    const state = useSaved();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const saved = state.loaded && isSaved(kind, id);

    // Resume after sign-in: land back here with ?save=1 and the sheet opens, once
    // the store knows we're signed in and this isn't already saved.
    useEffect(() => {
        if (autoOpen && state.loaded && state.signedIn && !isSaved(kind, id)) {
            setSheetOpen(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpen, state.loaded, state.signedIn]);

    const onClick = async (e: React.MouseEvent) => {
        // On a card the whole tile is a link; the heart must not navigate.
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;

        if (!state.loaded) return; // still loading; ignore the tap
        if (!state.signedIn) {
            const sep = href.includes('?') ? '&' : '?';
            openAuthPanel(href + sep + 'save=1');
            return;
        }
        if (saved) {
            setBusy(true);
            try { await removeSaved(kind, id); } finally { setBusy(false); }
        } else {
            setSheetOpen(true);
        }
    };

    const heart = (
        <svg viewBox="0 0 24 24" className={variant === 'card' ? 'h-5 w-5' : 'h-5 w-5'} fill={saved ? '#e11d48' : 'rgba(0,0,0,0.45)'} stroke="white" strokeWidth="2" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-10-9A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 10 7c-2.5 4.4-10 9-10 9Z" />
        </svg>
    );

    // A round white icon button, ~40px, over the photo — a dark heart outline that
    // fills red when saved (Airbnb's mobile hero control).
    const overlayHeart = (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill={saved ? '#e11d48' : 'none'} stroke={saved ? '#e11d48' : 'currentColor'} strokeWidth="2.2" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-10-9A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 10 7c-2.5 4.4-10 9-10 9Z" />
        </svg>
    );

    return (
        <>
            {variant === 'overlay' ? (
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
                    aria-pressed={saved}
                    className={'flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur transition hover:bg-white active:scale-95 ' + (className || '')}
                >
                    {overlayHeart}
                </button>
            ) : variant === 'card' ? (
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
                    aria-pressed={saved}
                    className={'relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition hover:scale-105 active:scale-95 ' + (className || '')}
                >
                    {heart}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
                    aria-pressed={saved}
                    className={'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-800 underline-offset-2 transition hover:bg-slate-100 ' + (className || '')}
                >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={saved ? '#e11d48' : 'none'} stroke={saved ? '#e11d48' : 'currentColor'} strokeWidth="2" aria-hidden="true">
                        <path d="M12 21s-7.5-4.6-10-9A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 10 7c-2.5 4.4-10 9-10 9Z" />
                    </svg>
                    {saved ? 'Saved' : 'Save'}
                </button>
            )}

            <SaveSheet open={sheetOpen} onClose={() => setSheetOpen(false)} kind={kind} id={id} />
        </>
    );
}

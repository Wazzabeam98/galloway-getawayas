'use client';

import { useState, useEffect } from 'react';
import SharePopup from '@/components/SharePopup';
import HeartButton from '@/components/save/HeartButton';
import type { SavedKind } from '@/lib/savedStore';

// The Share + Save pair at the top-right of a holiday-let or experience page,
// like Airbnb. Share opens the shared pop-up (with the place's photo and summary);
// Save is the heart. If the page was reached with ?save=1 (a signed-out visitor
// who tapped Save, then signed in), the Save sheet opens on its own.
export default function ShareSaveButtons({
    kind,
    id,
    href,
    shareTitle,
    shareSummary,
    sharePhoto,
    variant = 'inline',
}: {
    kind: SavedKind;
    id: string;
    href: string;
    shareTitle: string;
    shareSummary: string;
    sharePhoto: string | null;
    // 'inline' — the text Share/Save pair in the title row (desktop). 'overlay' —
    // round white icon-only buttons over the photo on a mobile listing page
    // (Airbnb's mobile pattern); the page shows this one below md and the inline
    // pair at md+.
    variant?: 'inline' | 'overlay';
}) {
    const [shareOpen, setShareOpen] = useState(false);
    // Read the ?save=1 resume intent from the URL on the client only (not
    // useSearchParams, which would force these ISR pages into dynamic rendering).
    const [autoOpenSave, setAutoOpenSave] = useState(false);
    useEffect(() => {
        try { setAutoOpenSave(new URLSearchParams(window.location.search).get('save') === '1'); } catch { /* ignore */ }
    }, []);

    // The canonical URL of this page — the origin (the live domain in production)
    // plus the clean path, never the current URL's own query (e.g. ?save=1).
    const shareUrl = (typeof window !== 'undefined' ? window.location.origin : '') + href;
    const shareText = shareSummary + ' — on Galloway Getaways: ' + shareUrl;

    const popup = (
        <SharePopup
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            title={shareTitle}
            url={shareUrl}
            shareText={shareText}
            emailSubject={shareTitle}
            preview={{ photo: sharePhoto, summary: shareSummary }}
        />
    );

    // The mobile photo overlay: two round white icon-only buttons (Airbnb's hero
    // controls). No labels — the icons carry it, and space over a photo is tight.
    if (variant === 'overlay') {
        return (
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    aria-label="Share"
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur transition hover:bg-white active:scale-95"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" /></svg>
                </button>
                <HeartButton kind={kind} id={id} href={href} variant="overlay" autoOpen={autoOpenSave} />
                {popup}
            </div>
        );
    }

    return (
        <div className="flex flex-none items-center gap-1">
            <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" /></svg>
                Share
            </button>

            <HeartButton kind={kind} id={id} href={href} variant="button" autoOpen={autoOpenSave} />

            {popup}
        </div>
    );
}

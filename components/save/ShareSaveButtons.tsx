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
}: {
    kind: SavedKind;
    id: string;
    href: string;
    shareTitle: string;
    shareSummary: string;
    sharePhoto: string | null;
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

            <SharePopup
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                title={shareTitle}
                url={shareUrl}
                shareText={shareText}
                emailSubject={shareTitle}
                preview={{ photo: sharePhoto, summary: shareSummary }}
            />
        </div>
    );
}

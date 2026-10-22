'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

// One share pop-up, used by the referral page and by Share on a holiday let or
// experience. Copy link / Email / Messages / WhatsApp / Messenger / Facebook / X
// / More (the device's own share sheet). An optional `preview` shows the thing
// being shared — a photo and a one-line summary — above the buttons.

function WhatsAppIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" /></svg>);
}
function MessengerIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.19.16.14.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.99-.88c.17-.07.36-.09.54-.04 1.03.28 2.13.44 3.28.44 5.64 0 10-4.13 10-9.7C22.79 6.13 17.64 2 12 2Zm6 7.46-2.93 4.65c-.47.74-1.47.92-2.17.4l-2.33-1.75a.6.6 0 0 0-.72 0l-3.15 2.39c-.42.32-.97-.18-.69-.63l2.93-4.65c.47-.74 1.47-.92 2.17-.4l2.33 1.75c.21.16.51.16.72 0l3.15-2.39c.42-.32.97.18.69.63Z" /></svg>);
}
function FacebookIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47H15.2c-1.24 0-1.63.78-1.63 1.58v1.87h2.78l-.44 2.9h-2.34V22c4.78-.79 8.43-4.94 8.43-9.94Z" /></svg>);
}
function XIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M18.9 2.5h3.3l-7.2 8.25L23.5 21.5h-6.6l-5.18-6.78-5.93 6.78H2.5l7.7-8.8L2 2.5h6.77l4.68 6.19L18.9 2.5Zm-1.16 17h1.83L7.3 4.4H5.34l12.4 15.1Z" /></svg>);
}

export interface SharePopupProps {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    url: string;
    shareText: string;
    emailSubject?: string;
    tweetText?: string;
    nativeTitle?: string;
    nativeText?: string;
    preview?: { photo?: string | null; summary: string };
}

export default function SharePopup({
    open,
    onClose,
    title,
    subtitle,
    url,
    shareText,
    emailSubject,
    tweetText,
    nativeTitle,
    nativeText,
    preview,
}: SharePopupProps) {
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);

    // Reset the copied state each time it opens.
    useEffect(() => {
        if (open) { setCopied(false); setCopyFailed(false); }
    }, [open]);

    if (typeof document === 'undefined' || !open) return null;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setCopyFailed(false);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopyFailed(true);
        }
    };

    const nativeShare = async () => {
        if (typeof navigator !== 'undefined' && (navigator as any).share) {
            try {
                await (navigator as any).share({ title: nativeTitle || title, text: nativeText || subtitle || shareText, url });
            } catch { /* cancelled */ }
        } else {
            copy();
        }
    };

    const tile = 'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50';
    const subject = emailSubject || title;
    const tweet = tweetText || subtitle || shareText;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                {preview && (
                    <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 p-2">
                        {preview.photo ? (
                            <img src={preview.photo} alt="" className="h-14 w-14 flex-none rounded-lg object-cover" />
                        ) : (
                            <div className="h-14 w-14 flex-none rounded-lg bg-slate-100" />
                        )}
                        <p className="min-w-0 text-sm text-slate-700">{preview.summary}</p>
                    </div>
                )}

                <button
                    type="button"
                    onClick={copy}
                    className={'mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition ' + (copied ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-700')}
                >
                    {copied ? 'Copied' : 'Copy link'}
                </button>
                {copyFailed && (
                    <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" />
                )}

                <div className="mt-3 grid grid-cols-4 gap-2">
                    <a href={'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(shareText)} className={tile}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                        Email
                    </a>
                    <a href={'sms:?&body=' + encodeURIComponent(shareText)} className={tile}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" /></svg>
                        Messages
                    </a>
                    <a href={'https://wa.me/?text=' + encodeURIComponent(shareText)} target="_blank" rel="noreferrer" className={tile}>
                        <WhatsAppIcon className="h-5 w-5" /> WhatsApp
                    </a>
                    <a href={'fb-messenger://share/?link=' + encodeURIComponent(url)} className={tile}>
                        <MessengerIcon className="h-5 w-5" /> Messenger
                    </a>
                    <a href={'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)} target="_blank" rel="noreferrer" className={tile}>
                        <FacebookIcon className="h-5 w-5" /> Facebook
                    </a>
                    <a href={'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(tweet)} target="_blank" rel="noreferrer" className={tile}>
                        <XIcon className="h-5 w-5" /> X
                    </a>
                    <button type="button" onClick={nativeShare} className={tile}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
                        More
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

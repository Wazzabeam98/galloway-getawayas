'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuestionSheets } from './questionSheets';
import { WizardShell, wizardPrimaryCls } from '@/components/services/wizardKit';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';

// The listing editor's summary card and the panel it opens — Airbnb's listing
// editor shape: a raised card shows the current answer in one line, a click
// opens the choices. Shared by Property type, How guests get in and Sleeping
// arrangements so the three look and behave the same.

// The lifted-card treatment (see CLAUDE.md): an act-on surface.
export function EditorCard({ title, summary, onClick, children }: {
    title: string;
    summary?: ReactNode;
    onClick: () => void;
    children?: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-[0_6px_16px_rgba(0,0,0,0.12)] transition hover:border-slate-300"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-semibold text-slate-900 line-clamp-2 break-words">{title}</div>
                    {/* A couple of lines, then "…" — a long description/address/rule
                        never runs off the card or widens it. break-words so an
                        unbroken token (a URL, a what3words) wraps rather than
                        pushing the card past the page edge. */}
                    {summary && <div className="mt-0.5 line-clamp-2 break-words text-sm text-slate-500">{summary}</div>}
                </div>
                <ChevronRight className="h-5 w-5 flex-none text-slate-400" />
            </div>
            {children}
        </button>
    );
}

export { QuestionSheetContext, useQuestionSheets } from './questionSheets';

// On a phone a full-screen sheet that slides up from the bottom (Airbnb's):
// close X top left, the footer (Save) fixed at the bottom. From sm up the
// centred dialog, unchanged. Rendered in a portal,
// but React events still bubble to the editor's <form>, so every button in a
// panel must be type="button".
export function EditorPanel({ title, onClose, footer, children, leading, trailing, alignTop }: {
    title: string;
    onClose: () => void;
    footer?: ReactNode;
    children: ReactNode;
    // Replaces the close button on the left (a back arrow in a nested view).
    leading?: ReactNode;
    // A button on the right of the title (the Photos sheet's "+").
    trailing?: ReactNode;
    // A question sheet: content under the question, not centred (a photo).
    alignTop?: boolean;
}) {
    // Mounted off-screen, then moved into place on the next frame so the slide
    // runs. The transform only applies below sm.
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const raf = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(raf);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
        };
    }, [onClose]);

    const question = useQuestionSheets();
    if (typeof document === 'undefined') return null;

    if (question) {
        return createPortal(
            <WizardShell single title={title} onClose={onClose} leading={leading} trailing={trailing} footer={footer} alignTop={alignTop}>
                {children}
            </WizardShell>,
            document.body,
        );
    }

    return createPortal(
        <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 transition-opacity duration-200 sm:items-center sm:px-4 sm:opacity-100 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`flex h-[100dvh] w-full flex-col bg-white shadow-xl transition-transform duration-300 ease-out will-change-transform sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl sm:translate-y-0 sm:transition-none ${shown ? 'translate-y-0' : 'translate-y-full'}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="relative flex items-center justify-center border-b border-slate-100 px-5 py-4">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        {leading || (
                            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100">
                                <X className="h-5 w-5" />
                            </button>
                        )}
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{title}</h2>
                    {trailing && <div className="absolute right-4 top-1/2 -translate-y-1/2">{trailing}</div>}
                </div>
                {/* data-sheet-scroll: what scrolls inside a sheet (the photo drag follows it). */}
                <div data-sheet-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
                {footer && <div className="border-t border-slate-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}

// A sheet's Save. The editor writes the listing as each sheet is saved
// (there is no Save for the whole page), so the handler may be async: it
// resolves false when the write failed, and the sheet stays open with what the
// host typed. "Saving…" while it runs, and a second tap does nothing.
export function PanelSave({ onClick, label = 'Save', disabled }: { onClick: () => unknown; label?: string; disabled?: boolean }) {
    const [busy, setBusy] = useState(false);
    const question = useQuestionSheets();
    const run = async () => {
        if (busy) return;
        setBusy(true);
        try { await onClick(); } finally { setBusy(false); }
    };
    if (question) {
        return (
            <button type="button" onClick={run} disabled={disabled || busy} className={wizardPrimaryCls(disabled || busy)}>
                {busy ? 'Saving…' : label}
            </button>
        );
    }
    return (
        <div className="flex justify-end">
            <button type="button" onClick={run} disabled={disabled || busy}
                className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
                {busy ? 'Saving…' : label}
            </button>
        </div>
    );
}

// Whether a card's onSave went through: anything but an explicit false
// (a handler that returns nothing is a plain state update, as before).
export async function saved(result: unknown): Promise<boolean> {
    return (await result) !== false;
}

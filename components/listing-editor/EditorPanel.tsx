'use client';

import { useEffect, type ReactNode } from 'react';
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
                    <div className="font-semibold text-slate-900">{title}</div>
                    {summary && <div className="mt-0.5 truncate text-sm text-slate-500">{summary}</div>}
                </div>
                <ChevronRight className="h-5 w-5 flex-none text-slate-400" />
            </div>
            {children}
        </button>
    );
}

// Bottom sheet on a phone, centred dialog from sm up. Rendered in a portal,
// but React events still bubble to the editor's <form>, so every button in a
// panel must be type="button".
export function EditorPanel({ title, onClose, footer, children, leading }: {
    title: string;
    onClose: () => void;
    footer?: ReactNode;
    children: ReactNode;
    // Replaces the close button on the left (a back arrow in a nested view).
    leading?: ReactNode;
}) {
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

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:px-4" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
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
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
                {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
            </div>
        </div>,
        document.body,
    );
}

export function PanelSave({ onClick, label = 'Save', disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
    return (
        <div className="flex justify-end">
            <button type="button" onClick={onClick} disabled={disabled}
                className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
                {label}
            </button>
        </div>
    );
}

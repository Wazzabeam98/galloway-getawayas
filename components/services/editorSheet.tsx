'use client';

import { useState } from 'react';
import { saved } from '@/components/listing-editor/EditorPanel';
import { useQuestionSheets } from '@/components/listing-editor/questionSheets';
import { wizardPrimaryCls } from './wizardKit';

// Small shared pieces for the experience editor's sheets — a sentence-case field
// label (not the uppercase the reused holiday cards use), the Cancel/Save footer,
// and the open/draft/save hook. Shared by the editor and the item flow so they
// stay one design.

export const inputCls = 'w-full rounded-xl border border-slate-300 p-3 text-sm';

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    // In a question sheet the question is the label: no grey hint under it.
    const question = useQuestionSheets();
    return (
        <label className="block">
            <span className={'block font-semibold text-slate-800 ' + (question ? 'text-base' : 'text-sm')}>{label}</span>
            {hint && !question && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
            <div className="mt-1.5">{children}</div>
        </label>
    );
}

export function SheetFooter({ busy, onCancel, onSave, disabled, disabledLabel }: {
    busy: boolean; onCancel: () => void; onSave: () => void; disabled?: boolean; disabledLabel?: string;
}) {
    // A question sheet: Save bottom right; the shell puts Cancel beside it.
    if (useQuestionSheets()) {
        return (
            <button type="button" onClick={onSave} disabled={busy || disabled} className={wizardPrimaryCls(busy || disabled)}>
                {busy ? 'Saving…' : (disabled && disabledLabel) ? disabledLabel : 'Save'}
            </button>
        );
    }
    return (
        <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onCancel} className="text-sm font-semibold text-slate-900 underline">Cancel</button>
            <button type="button" onClick={onSave} disabled={busy || disabled}
                className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? 'Saving…' : (disabled && disabledLabel) ? disabledLabel : 'Save'}
            </button>
        </div>
    );
}

// Open / draft / save plumbing for a card: a fresh draft when the sheet opens,
// write on Save, close only if the write went through.
export function useCardSheet<T>(current: T, onSave: (draft: T) => unknown) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<T>(current);
    const [busy, setBusy] = useState(false);
    const start = () => { setDraft(current); setOpen(true); };
    const close = () => setOpen(false);
    const save = async () => {
        if (busy) return;
        setBusy(true);
        try { if (await saved(onSave(draft))) setOpen(false); } finally { setBusy(false); }
    };
    return { open, draft, setDraft, busy, start, close, save };
}

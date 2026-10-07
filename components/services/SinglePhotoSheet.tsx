'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
import { EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';

// One photo, edited like every other sheet: a + at the top right opens the
// photo library to add the photo or replace it, a bin on the photo removes it
// after "Remove this photo?", and Save at the bottom right writes the change
// (Cancel / the X leave it as it was). The photo is shown whole at its own
// shape — it's only cropped where it's used. No photo: the Photos empty state.
// Used by an offering's Photo card and the host profile's "Your photo".
export function SinglePhotoSheet({ emptyTitle, title, image, upload, onSave, onClose, round = false }: {
    // The heading with no photo yet ("Add a photo"), and with one ("Photo").
    emptyTitle: string;
    title: string;
    image: string | null;
    // Uploads the chosen file and returns its storage path (null = failed; it says why).
    upload: (file: File) => Promise<string | null>;
    // Writes the new path, or null to remove; false = didn't save.
    onSave: (path: string | null) => unknown;
    onClose: () => void;
    // A round portrait (the host's photo) rather than a picture.
    round?: boolean;
}) {
    const [shown, setShown] = useState(image);
    const [uploading, setUploading] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const picker = useRef<HTMLInputElement>(null);

    const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        try {
            const path = await upload(file);
            if (path) setShown(path);
        } finally { setUploading(false); }
    };
    const save = async () => {
        if (shown === image || await saved(onSave(shown))) onClose();
    };

    return (
        <EditorPanel title={shown ? title : emptyTitle} onClose={onClose} alignTop
            trailing={
                <button type="button" onClick={() => picker.current?.click()} disabled={uploading}
                    aria-label={shown ? 'Replace photo' : 'Add photo'}
                    className="rounded-full p-1.5 text-slate-900 hover:bg-slate-100 disabled:opacity-40">
                    <Plus className="h-6 w-6" />
                </button>
            }
            footer={<PanelSave onClick={save} disabled={uploading} />}>
            {/* The phone's photo library. Off-screen rather than display:none,
                which some phones won't open from a tap. */}
            <input ref={picker} type="file" accept="image/png, image/jpeg" onChange={pick}
                className="sr-only" tabIndex={-1} aria-hidden="true" data-photo-picker />
            {uploading ? (
                <p className="py-10 text-center text-sm text-slate-500">Uploading…</p>
            ) : shown ? (
                <div className="flex flex-col items-center">
                    <div className={'relative ' + (round ? 'h-40 w-40' : 'w-fit max-w-full')}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImageUrl(shown)} alt=""
                            className={round ? 'h-40 w-40 rounded-full bg-slate-100 object-cover ring-1 ring-slate-200' : 'block h-auto max-h-[55vh] w-auto max-w-full rounded-2xl bg-slate-100 ring-1 ring-slate-200'} />
                        <button type="button" onClick={() => setConfirming(true)} aria-label="Remove this photo"
                            className={'absolute flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow ' + (round ? 'right-1 top-1' : 'right-2 top-2')}>
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                    <p className="mt-3 text-center text-sm text-slate-600">To replace it, use the + at the top right.</p>
                </div>
            ) : (
                <p className="py-10 text-center text-sm text-slate-500">No photo yet. Tap + to add one.</p>
            )}
            {confirming && <ConfirmRemove onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); setShown(null); }} />}
        </EditorPanel>
    );
}

// The listing editor's "Delete this photo?" confirm, worded for one photo. Above
// everything, the add flow (z-70) included, so it can always be answered.
export function ConfirmRemove({ onCancel, onConfirm, body = 'It comes off your listing when you save.' }: { onCancel: () => void; onConfirm: () => void; body?: string }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onCancel]);
    return createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6" onClick={onCancel}>
            <div role="alertdialog" aria-modal="true" aria-label="Remove this photo?"
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-slate-900">Remove this photo?</h2>
                <p className="mt-1 text-sm text-slate-500">{body}</p>
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-900 underline">Cancel</button>
                    <button type="button" onClick={onConfirm} className="rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">Remove</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

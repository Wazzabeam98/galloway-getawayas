'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { preparePhoto, type PreparedPhoto } from '@/lib/preparePhoto';
import { MAX_PHOTOS_PER_MESSAGE, PHOTO_ERRORS } from '@/lib/messagePhotos';

// Photos in a booking's messages: the attach button, the strip of photos about
// to be sent, the thumbnails in the thread, and the full-size viewer.
//
// Every image is opened through /api/messages/photos/<id>, which checks who is
// asking and redirects to a one-minute signed link. Nothing here holds a
// storage URL.

export type MessageAttachment = { id: string; width?: number | null; height?: number | null };

const photoSrc = (id: string, thumb: boolean) => '/api/messages/photos/' + id + (thumb ? '?size=thumb' : '');

/** The attach button. On a phone it offers the camera or the photo library. */
export function AttachPhotoButton({
    count, onAdd, disabled, className,
}: {
    count: number;
    onAdd: (photos: PreparedPhoto[]) => void;
    disabled?: boolean;
    className?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const pick = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const list = Array.from(files);
        const room = MAX_PHOTOS_PER_MESSAGE - count;
        if (list.length > room) toast.error(PHOTO_ERRORS.tooMany, { theme: 'colored' });
        setBusy(true);
        const ready: PreparedPhoto[] = [];
        for (const f of list.slice(0, Math.max(0, room))) {
            try {
                ready.push(await preparePhoto(f));
            } catch (e: any) {
                toast.error((e && e.message) || PHOTO_ERRORS.unreadable, { theme: 'colored' });
            }
        }
        setBusy(false);
        if (ready.length) onAdd(ready);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => inputRef.current && inputRef.current.click()}
                disabled={disabled || busy || count >= MAX_PHOTOS_PER_MESSAGE}
                aria-label="Add photos"
                title="Add photos"
                className={className}
            >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            </button>
            {/* No `capture`: that would force the camera. Without it a phone
                asks — take a photo, or choose from the library. */}
            <input
                ref={inputRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="hidden"
                data-testid="message-photo-input"
                onChange={(e) => {
                    const files = e.target.files;
                    pick(files).finally(() => { if (inputRef.current) inputRef.current.value = ''; });
                }}
            />
        </>
    );
}

/** The photos chosen but not yet sent, above the composer. */
export function PendingPhotos({ photos, onRemove }: { photos: PreparedPhoto[]; onRemove: (i: number) => void }) {
    if (!photos.length) return null;
    return (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1" data-testid="pending-photos">
            {photos.map((p, i) => (
                <div key={p.previewUrl} className="relative flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                    <button
                        type="button"
                        onClick={() => onRemove(i)}
                        aria-label="Remove photo"
                        className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}

/** The photos on a sent message, as thumbnails that open full size. */
export function MessagePhotoGrid({ attachments, mine }: { attachments: MessageAttachment[]; mine: boolean }) {
    const [open, setOpen] = useState<number | null>(null);
    if (!attachments || attachments.length === 0) return null;
    const one = attachments.length === 1;
    return (
        <>
            <div
                className={'grid gap-1 ' + (one ? 'grid-cols-1' : 'grid-cols-2') + ' ' + (mine ? 'justify-items-end' : 'justify-items-start')}
                data-testid="message-photos"
            >
                {attachments.map((a, i) => (
                    <button
                        key={a.id}
                        type="button"
                        onClick={() => setOpen(i)}
                        aria-label="Open photo"
                        className={'block overflow-hidden rounded-2xl bg-slate-100 ' + (one ? 'w-56 max-w-full' : 'w-28 h-28')}
                        style={one && a.width && a.height ? { aspectRatio: a.width + ' / ' + a.height, maxHeight: 320 } : undefined}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={photoSrc(a.id, true)}
                            alt="Photo"
                            loading="lazy"
                            className="w-full h-full object-cover"
                        />
                    </button>
                ))}
            </div>
            {open !== null && (
                <PhotoViewer attachments={attachments} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
            )}
        </>
    );
}

function PhotoViewer({
    attachments, index, onIndex, onClose,
}: {
    attachments: MessageAttachment[];
    index: number;
    onIndex: (i: number) => void;
    onClose: () => void;
}) {
    const many = attachments.length > 1;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (many && e.key === 'ArrowRight') onIndex((index + 1) % attachments.length);
            if (many && e.key === 'ArrowLeft') onIndex((index - 1 + attachments.length) % attachments.length);
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [index, many, attachments.length, onClose, onIndex]);

    const a = attachments[index];
    return (
        <div
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-label="Photo"
            onClick={onClose}
            data-testid="photo-viewer"
        >
            <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            >
                <X className="w-5 h-5" />
            </button>
            {many && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 text-sm text-white/80">
                    {index + 1} / {attachments.length}
                </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                key={a.id}
                src={photoSrc(a.id, false)}
                alt="Photo"
                className="max-w-[100vw] max-h-[85vh] object-contain"
                onClick={(e) => e.stopPropagation()}
            />
            {many && (
                <>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + attachments.length) % attachments.length); }}
                        aria-label="Previous photo"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-slate-900 flex items-center justify-center"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % attachments.length); }}
                        aria-label="Next photo"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-slate-900 flex items-center justify-center"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </>
            )}
        </div>
    );
}

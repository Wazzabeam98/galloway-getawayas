'use client';

// Gets a photo ready to send, in the browser, before it leaves the phone:
//   - an iPhone HEIC is turned into a JPEG (heic2any, loaded only when needed)
//   - it is drawn upright (the camera's rotation is applied) and shrunk to
//     2048px on the long edge, then re-encoded as a JPEG — which leaves every
//     piece of EXIF behind, GPS included
//   - a 480px copy is made for the thread's thumbnail
// The server checks it all again (lib/messagePhotos) and strips anything left.

import {
    FULL_EDGE, THUMB_EDGE, MAX_PHOTO_BYTES, PHOTO_ERRORS, checkPickedFile, isHeic,
} from './messagePhotos';

export type PreparedPhoto = {
    full: Blob;
    thumb: Blob;
    width: number;
    height: number;
    previewUrl: string;
};

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(blob, { imageOrientation: 'from-image' } as any);
        } catch {
            // Fall through to <img>, which some browsers decode more of.
        }
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
    const w = (src as any).naturalWidth || (src as any).width;
    const h = (src as any).naturalHeight || (src as any).height;
    return { w, h };
}

function encode(src: ImageBitmap | HTMLImageElement, edge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
    const { w, h } = sizeOf(src);
    const scale = Math.min(1, edge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('no canvas'));
    // A transparent PNG would turn black as a JPEG; give it a white ground.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src as any, 0, 0, cw, ch);
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve({ blob: b, w: cw, h: ch }) : reject(new Error('encode failed'))), 'image/jpeg', quality);
    });
}

async function heicToJpeg(file: Blob): Promise<Blob> {
    const mod: any = await import('heic2any');
    const out = await (mod.default || mod)({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(out) ? out[0] : out;
}

/** Prepare one picked file. Throws an Error whose message is safe to show. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
    const problem = checkPickedFile(file);
    if (problem) throw new Error(problem);

    let source: ImageBitmap | HTMLImageElement;
    try {
        // Safari can read HEIC itself; everything else needs converting first.
        source = await decode(file);
    } catch {
        if (!isHeic(file)) throw new Error(PHOTO_ERRORS.unreadable);
        try {
            source = await decode(await heicToJpeg(file));
        } catch {
            throw new Error(PHOTO_ERRORS.unreadable);
        }
    }

    let full = await encode(source, FULL_EDGE, 0.85);
    // A very detailed photo can still come out big; try once more, smaller.
    if (full.blob.size > MAX_PHOTO_BYTES) full = await encode(source, 1600, 0.75);
    if (full.blob.size > MAX_PHOTO_BYTES) throw new Error(PHOTO_ERRORS.tooLarge);
    const thumb = await encode(source, THUMB_EDGE, 0.75);
    if ('close' in source && typeof (source as any).close === 'function') (source as any).close();

    return {
        full: full.blob,
        thumb: thumb.blob,
        width: full.w,
        height: full.h,
        previewUrl: URL.createObjectURL(thumb.blob),
    };
}

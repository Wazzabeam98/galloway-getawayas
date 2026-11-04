// Photos in booking messages — the rules, in one place, for the browser and the
// server alike (CLAUDE.md: every client-side check is mirrored server-side
// through one shared helper).
//
// The browser prepares each photo before it leaves the phone (lib/preparePhoto:
// HEIC → JPEG, shrunk, re-encoded, which drops EXIF/GPS). The server does not
// trust that: it sniffs the bytes to prove they are an image, enforces the size
// and count again, and strips any metadata a hand-built upload still carries.
//
// Pure, no imports, so the unit tests run it directly.

export const PHOTO_BUCKET = 'message-attachments';

/** Photos one message may carry. */
export const MAX_PHOTOS_PER_MESSAGE = 6;

/** The largest file the server stores (after the browser has shrunk it). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** The largest original the browser will try to shrink. */
export const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;

/** The long edge of the stored photo, and of the thumbnail. */
export const FULL_EDGE = 2048;
export const THUMB_EDGE = 480;

export const STORED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type StoredType = typeof STORED_TYPES[number];

/** How long a signed link to a photo lives. */
export const SIGNED_URL_SECONDS = 60;

export const PHOTO_ERRORS = {
    notImage: 'That file isn’t a photo. You can send JPEG, PNG, WebP or HEIC images.',
    tooLarge: 'That photo is too large. Each photo must be under 10MB.',
    tooMany: 'You can send up to ' + MAX_PHOTOS_PER_MESSAGE + ' photos in one message.',
    unreadable: 'That photo couldn’t be opened. Try taking it again or choosing another.',
};

const EXT_TYPES: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
};

/** HEIC/HEIF, by type or (when the browser reports none) by name. */
export function isHeic(file: { type?: string; name?: string }): boolean {
    const t = String(file.type || '').toLowerCase();
    if (t === 'image/heic' || t === 'image/heif' || t === 'image/heic-sequence' || t === 'image/heif-sequence') return true;
    return /\.(heic|heif)$/i.test(String(file.name || ''));
}

/**
 * The browser's first look at a picked file, before any work is done on it.
 * Returns an error to show, or null when it is worth preparing.
 */
export function checkPickedFile(file: { type?: string; name?: string; size: number }): string | null {
    const type = String(file.type || '').toLowerCase()
        || EXT_TYPES[(String(file.name || '').split('.').pop() || '').toLowerCase()] || '';
    if (!type.startsWith('image/') && !isHeic(file)) return PHOTO_ERRORS.notImage;
    if (type === 'image/svg+xml') return PHOTO_ERRORS.notImage;
    if (!(file.size > 0)) return PHOTO_ERRORS.unreadable;
    if (file.size > MAX_ORIGINAL_BYTES) return PHOTO_ERRORS.tooLarge;
    return null;
}

/** What the bytes really are, whatever the upload claimed. */
export function sniffImageType(bytes: Uint8Array): StoredType | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
    return null;
}

/**
 * The browser's look at a picked file's first bytes: something it can turn into
 * a photo (JPEG/PNG/WebP, GIF, or an HEIC/HEIF/AVIF container), or not.
 */
export function looksLikePhoto(head: Uint8Array): boolean {
    if (sniffImageType(head)) return true;
    if (ascii(head, 0, 4) === 'GIF8') return true;
    // ISO-BMFF: "ftyp" then a brand — heic, heix, mif1, msf1, avif …
    if (ascii(head, 4, 4) === 'ftyp') return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/.test(ascii(head, 8, 4));
    return false;
}

/** The server's check on one file it is about to store: its real type, or why not. */
export function checkStoredPhoto(bytes: Uint8Array): { type: StoredType } | { error: string } {
    if (bytes.length > MAX_PHOTO_BYTES) return { error: PHOTO_ERRORS.tooLarge };
    const type = sniffImageType(bytes);
    if (!type) return { error: PHOTO_ERRORS.notImage };
    return { type };
}

/** "Sent a photo" / "Sent 3 photos" — previews, emails and pushes. */
export function photoLabel(count: number): string {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 1) return 'Sent a photo';
    return 'Sent ' + n + ' photos';
}

/** A message's preview line: its words if it has any, else the photo label. */
export function messagePreview(body: string | null | undefined, photoCount: number | null | undefined): string {
    const text = String(body || '').trim();
    if (text) return text;
    return Number(photoCount) > 0 ? photoLabel(Number(photoCount)) : '';
}

// ---------------------------------------------------------------------------
// Metadata stripping. Removes EXIF (which carries GPS), XMP, comments and text
// chunks; keeps only what is needed to draw the picture (and a colour profile).
// ---------------------------------------------------------------------------

function ascii(b: Uint8Array, at: number, len: number): string {
    let s = '';
    for (let i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
}

function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    parts.forEach((p) => { total += p.length; });
    const out = new Uint8Array(total);
    let at = 0;
    parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
}

/** JPEG: drop APP1–APP15 (EXIF, XMP, …) except an ICC profile, and COM. */
function stripJpeg(b: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [b.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= b.length) {
        if (b[i] !== 0xff) throw new Error('bad jpeg segment');
        const marker = b[i + 1];
        // Start of scan: everything from here is picture data.
        if (marker === 0xda) { parts.push(b.subarray(i)); return concat(parts); }
        // Markers with no length.
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
            if (marker === 0xff) { i += 1; continue; }
            parts.push(b.subarray(i, i + 2)); i += 2; continue;
        }
        if (marker === 0xd9) { parts.push(b.subarray(i, i + 2)); return concat(parts); }
        const len = (b[i + 2] << 8) | b[i + 3];
        if (len < 2 || i + 2 + len > b.length) throw new Error('bad jpeg length');
        const seg = b.subarray(i, i + 2 + len);
        const isApp = marker >= 0xe1 && marker <= 0xef;
        const isIcc = marker === 0xe2 && ascii(b, i + 4, 11) === 'ICC_PROFILE';
        const isCom = marker === 0xfe;
        if (!(isApp && !isIcc) && !isCom) parts.push(seg);
        i += 2 + len;
    }
    throw new Error('jpeg ended early');
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: drop eXIf and the text/time chunks. */
function stripPng(b: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    let i = 8;
    while (i + 12 <= b.length) {
        const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
        const type = ascii(b, i + 4, 4);
        const end = i + 12 + len;
        if (end > b.length) throw new Error('bad png chunk');
        if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
        i = end;
        if (type === 'IEND') return concat(parts);
    }
    throw new Error('png ended early');
}

/** WebP: drop the EXIF and XMP chunks and clear their flags. */
function stripWebp(b: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [];
    let i = 12;
    while (i + 8 <= b.length) {
        const type = ascii(b, i, 4);
        const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | ((b[i + 7] << 24) >>> 0);
        const end = i + 8 + len + (len % 2);
        if (i + 8 + len > b.length) throw new Error('bad webp chunk');
        if (type !== 'EXIF' && type !== 'XMP ') {
            const chunk = b.slice(i, Math.min(end, b.length));
            // VP8X flags: bit 3 = EXIF, bit 2 = XMP.
            if (type === 'VP8X' && chunk.length > 8) chunk[8] = chunk[8] & ~0x0c;
            parts.push(chunk);
        }
        i = end;
    }
    const body = concat(parts);
    const head = new Uint8Array(12);
    head.set(b.subarray(0, 12));
    const size = body.length + 4;
    head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
    return concat([head, body]);
}

/** The same picture with its metadata removed. Throws on a malformed file. */
export function stripImageMetadata(bytes: Uint8Array, type: StoredType): Uint8Array {
    if (type === 'image/jpeg') return stripJpeg(bytes);
    if (type === 'image/png') return stripPng(bytes);
    return stripWebp(bytes);
}

/** True when the bytes still carry EXIF/XMP anywhere a reader would find it. */
export function carriesMetadata(bytes: Uint8Array, type: StoredType): boolean {
    if (type === 'image/jpeg') {
        let i = 2;
        while (i + 4 <= bytes.length && bytes[i] === 0xff) {
            const marker = bytes[i + 1];
            if (marker === 0xda || marker === 0xd9) return false;
            const len = (bytes[i + 2] << 8) | bytes[i + 3];
            if (marker === 0xe1) return true;
            i += 2 + len;
        }
        return false;
    }
    if (type === 'image/png') {
        let i = 8;
        while (i + 12 <= bytes.length) {
            const len = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
            const t = ascii(bytes, i + 4, 4);
            if (t === 'eXIf') return true;
            if (t === 'IEND') return false;
            i += 12 + len;
        }
        return false;
    }
    let i = 12;
    while (i + 8 <= bytes.length) {
        const t = ascii(bytes, i, 4);
        const len = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | ((bytes[i + 7] << 24) >>> 0);
        if (t === 'EXIF' || t === 'XMP ') return true;
        i += 8 + len + (len % 2);
    }
    return false;
}

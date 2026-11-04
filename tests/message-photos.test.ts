// Photos in booking messages: what the server accepts, and what it strips.
//
// A guest's phone photo carries where it was taken. The browser re-encodes it
// (which drops EXIF), but the server must not rely on that — a hand-built
// upload, or a browser that hands the original over, still arrives with GPS in
// it. These prove the server's own checks: only real images by their bytes, no
// more than six, nothing over 10MB, and no EXIF/XMP left in what is stored.
// And that the photo is only ever opened through the gated route.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sniffImageType, checkStoredPhoto, stripImageMetadata, carriesMetadata, checkPickedFile,
    photoLabel, messagePreview, looksLikePhoto, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_MESSAGE, PHOTO_ERRORS,
} from '../lib/messagePhotos';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const bytes = (...parts: (number[] | string)[]) => {
    const out: number[] = [];
    parts.forEach((p) => {
        if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
        else out.push(...p);
    });
    return new Uint8Array(out);
};
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const seg = (marker: number, payload: Uint8Array | string) => {
    const p = typeof payload === 'string' ? bytes(payload) : payload;
    const len = p.length + 2;
    return bytes([0xff, marker, len >> 8, len & 0xff], Array.from(p));
};
const join = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));

// A JPEG shaped like a phone's: JFIF, EXIF with a GPS block, XMP, an ICC
// profile, a comment, then the picture.
const jpegWithGps = join(
    bytes([0xff, 0xd8]),
    seg(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
    seg(0xe1, 'Exif\0\0MM\0*GPSLatitude 54.8 GPSLongitude -4.05'),
    seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>photoshop:City Kirkcudbright</x:xmpmeta>'),
    seg(0xe2, 'ICC_PROFILE\0\x01\x01sRGBprofile'),
    seg(0xfe, 'taken at Millburn Cottage'),
    seg(0xdb, bytes([0, ...new Array(64).fill(1)])),
    seg(0xda, bytes([1, 1, 0, 0, 63, 0])),
    bytes([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    bytes([0xff, 0xd9]),
);

test('a JPEG loses its EXIF (GPS), XMP and comment, and keeps the picture and colour profile', () => {
    assert.equal(sniffImageType(jpegWithGps), 'image/jpeg');
    assert.ok(carriesMetadata(jpegWithGps, 'image/jpeg'));
    const out = stripImageMetadata(jpegWithGps, 'image/jpeg');
    assert.ok(!has(out, 'GPS'), 'no GPS');
    assert.ok(!has(out, 'Exif'), 'no EXIF');
    assert.ok(!has(out, 'xmpmeta') && !has(out, 'Kirkcudbright'), 'no XMP');
    assert.ok(!has(out, 'Millburn'), 'no comment');
    assert.ok(has(out, 'ICC_PROFILE'), 'colour profile kept');
    assert.ok(has(out, 'JFIF'));
    assert.ok(!carriesMetadata(out, 'image/jpeg'));
    // The scan data and end marker are untouched.
    assert.deepEqual(Array.from(out.slice(-8)), Array.from(jpegWithGps.slice(-8)));
    assert.equal(sniffImageType(out), 'image/jpeg');
});

const pngChunk = (type: string, data: string) => {
    const d = bytes(data);
    const len = d.length;
    return join(bytes([len >>> 24, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]), bytes(type), d, bytes([0, 0, 0, 0]));
};
const png = join(
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', '\0\0\0\x01\0\0\0\x01\x08\x02\0\0\0'),
    pngChunk('eXIf', 'MM\0*GPSLatitude'),
    pngChunk('tEXt', 'Comment\0taken at the cottage'),
    pngChunk('IDAT', 'xyz'),
    pngChunk('IEND', ''),
);

test('a PNG loses its eXIf and text chunks', () => {
    assert.equal(sniffImageType(png), 'image/png');
    assert.ok(carriesMetadata(png, 'image/png'));
    const out = stripImageMetadata(png, 'image/png');
    assert.ok(!has(out, 'GPS') && !has(out, 'cottage'));
    assert.ok(has(out, 'IHDR') && has(out, 'IDAT') && has(out, 'IEND'));
    assert.ok(!carriesMetadata(out, 'image/png'));
});

const riff = (type: string, data: Uint8Array) => {
    const len = data.length;
    const pad = len % 2 ? bytes([0]) : new Uint8Array(0);
    return join(bytes(type), bytes([len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, len >>> 24]), data, pad);
};

test('a WebP loses its EXIF and XMP chunks, their flags, and the RIFF size still adds up', () => {
    const vp8x = riff('VP8X', bytes([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const body = join(vp8x, riff('VP8 ', bytes('frame')), riff('EXIF', bytes('MM\0*GPS')), riff('XMP ', bytes('<x:xmpmeta/>')));
    const size = body.length + 4;
    const webp = join(bytes('RIFF'), bytes([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24]), bytes('WEBP'), body);
    assert.equal(sniffImageType(webp), 'image/webp');
    assert.ok(carriesMetadata(webp, 'image/webp'));
    const out = stripImageMetadata(webp, 'image/webp');
    assert.ok(!has(out, 'GPS') && !has(out, 'xmpmeta'));
    assert.ok(!carriesMetadata(out, 'image/webp'));
    assert.equal(out[20] & 0x0c, 0, 'EXIF/XMP flags cleared');
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    assert.equal(riffSize, out.length - 8);
});

test('the server judges a file by its bytes, not its name or claimed type', () => {
    assert.equal(sniffImageType(bytes('%PDF-1.7 ...')), null);
    assert.equal(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">')), null);
    assert.equal(sniffImageType(bytes('<html><script>')), null);
    assert.equal(sniffImageType(bytes('GIF89a')), null, 'GIFs are not stored');
    assert.deepEqual(checkStoredPhoto(bytes('%PDF-1.7')), { error: PHOTO_ERRORS.notImage });
    const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff]);
    assert.deepEqual(checkStoredPhoto(huge), { error: PHOTO_ERRORS.tooLarge });
    assert.deepEqual(checkStoredPhoto(jpegWithGps), { type: 'image/jpeg' });
});

test('the browser refuses a non-image or an oversized original with a clear message, and takes HEIC', () => {
    assert.equal(checkPickedFile({ type: 'application/pdf', name: 'receipt.pdf', size: 1000 }), PHOTO_ERRORS.notImage);
    assert.equal(checkPickedFile({ type: 'video/quicktime', name: 'leak.mov', size: 1000 }), PHOTO_ERRORS.notImage);
    assert.equal(checkPickedFile({ type: 'image/svg+xml', name: 'x.svg', size: 1000 }), PHOTO_ERRORS.notImage);
    assert.equal(checkPickedFile({ type: 'image/jpeg', name: 'a.jpg', size: 41 * 1024 * 1024 }), PHOTO_ERRORS.tooLarge);
    assert.equal(checkPickedFile({ type: 'image/heic', name: 'IMG_0001.HEIC', size: 3_000_000 }), null);
    assert.equal(checkPickedFile({ type: '', name: 'IMG_0001.HEIC', size: 3_000_000 }), null, 'HEIC with no type, by name');
    assert.equal(checkPickedFile({ type: 'image/jpeg', name: 'a.jpg', size: 2_000_000 }), null);
    assert.match(PHOTO_ERRORS.tooMany, new RegExp('up to ' + MAX_PHOTOS_PER_MESSAGE));
});

test('the browser looks at the bytes too: a renamed PDF is not a photo, an iPhone HEIC is', () => {
    assert.equal(looksLikePhoto(bytes('%PDF-1.4 1 0 obj')), false);
    assert.equal(looksLikePhoto(bytes('<svg xmlns=')), false);
    assert.equal(looksLikePhoto(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0])), true);
    assert.equal(looksLikePhoto(bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0])), true);
    assert.equal(looksLikePhoto(bytes([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0])), false, 'an MP4 is not a photo');
    assert.equal(looksLikePhoto(jpegWithGps.slice(0, 32)), true);
});

test('notifications and previews say "Sent a photo"', () => {
    assert.equal(photoLabel(1), 'Sent a photo');
    assert.equal(photoLabel(3), 'Sent 3 photos');
    assert.equal(messagePreview('', 1), 'Sent a photo');
    assert.equal(messagePreview('  ', 2), 'Sent 2 photos');
    assert.equal(messagePreview('The tap is leaking', 1), 'The tap is leaking');
    assert.equal(messagePreview('', 0), '');
    const trigger = read('supabase/migrations/20261104093000_message_photos.sql');
    assert.match(trigger, /then 'Sent a photo'/);
    assert.match(read('app/api/notify/route.ts'), /photoLabel\(photoCount\)/);
});

test('photos are private: a private bucket, a table the browser cannot reach, opened only through the gated route', () => {
    const sql = read('supabase/migrations/20261104093000_message_photos.sql');
    assert.match(sql, /values \('message-attachments', 'message-attachments', false,/);
    assert.match(sql, /revoke all on function public\.send_booking_message_with_photos\(uuid, uuid, uuid, text, jsonb\) from authenticated;/);

    const serve = read('app/api/messages/photos/[id]/route.ts');
    assert.match(serve, /auth\.getUser\(\)/, 'verified identity, never getSession');
    assert.match(serve, /threadOfAttachment\(att\)/, 'checked against the conversation the photo belongs to');
    assert.match(serve, /mayViewThreadPhotos\(admin, user\.id, thread\.kind, thread\.id\)/);
    assert.match(serve, /createSignedUrl\(key, SIGNED_URL_SECONDS\)/);
    assert.doesNotMatch(serve, /getPublicUrl/);

    // One upload path for every kind of thread.
    const upload = read('lib/messagePhotoUpload.ts');
    assert.match(upload, /checkStoredPhoto\(raw\)/);
    assert.match(upload, /stripImageMetadata\(raw, ok\.type\)/);
    assert.match(upload, /rpc\('send_thread_message_with_photos'/);
    assert.doesNotMatch(upload, /getPublicUrl/);
    const routes: [string, RegExp][] = [
        ['app/api/messages/threads/[bookingId]/photos/route.ts', /bookingPhotoRole\(admin, user\.id, params\.bookingId, \{ allowAdmin: false \}\)/],
        ['app/api/messages/order/[orderId]/route.ts', /orderThreadContext\(admin, orderId, user\.id\)/],
        ['app/api/messages/enquiry/[enquiryId]/route.ts', /enquiryThreadContext\(admin, enquiryId, user\.id\)/],
    ];
    for (const [f, gate] of routes) {
        const src = read(f);
        assert.match(src, /auth\.getUser\(\)/, f);
        assert.match(src, gate, f + ': sends only for the people in the conversation');
        assert.match(src, /readPhotoForm\(/, f + ': the shared upload path');
        assert.match(src, /storePhotoMessage\(admin/, f);
    }

    const access = read('lib/messagePhotoAccess.ts');
    assert.match(access, /checkListing\(uid, booking\.listing_id, 'can_messages'\)/, 'co-hosts need the messages permission');
    assert.match(access, /orderThreadContext\(admin, threadId, uid\)/, 'order photos: the guest and the business side only');
    assert.match(access, /enquiryThreadContext\(admin, threadId, uid\)/, 'enquiry photos: the host and the trade side only');

    const every = read('supabase/migrations/20261104120000_message_photos_every_thread.sql');
    assert.match(every, /check \(num_nonnulls\(booking_id, order_id, enquiry_id\) = 1\)/, 'a photo belongs to exactly one conversation');
    assert.match(every, /revoke all on function public\.send_thread_message_with_photos\(text, uuid, uuid, uuid, text, jsonb\) from authenticated;/);

    // Nothing in the browser ever reads the bucket directly.
    for (const f of ['app/messages/page.tsx', 'components/messages/MessagePhotos.tsx', 'components/marketplace/OrderThread.tsx']) {
        assert.doesNotMatch(read(f), /message-attachments|storage\.from/, f);
    }
});

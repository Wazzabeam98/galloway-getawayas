// Shrinks a photo in the browser before it's uploaded.
//
// Phone cameras produce 4–12MB files, and iPhones often produce HEIC, which
// the storage bucket won't take. Drawing the image to a canvas and
// re-exporting solves both: the result is always a reasonably sized JPEG.

// Longest side, in pixels. Raised from 2000 to 2560 on 8 Oct 2026: 2000 was
// enough for a 1080p screen, but the listing page's hero fills the width of the
// page, and on a large or retina display (a 1440p or 4K monitor at 2× pixel
// density) a full-width hero wants well over 2000px across — so a genuinely good
// photo was being softened there. 2560 covers a ~1280px-wide hero at 2× without
// upscaling. The byte target below rises in step, so the extra pixels keep their
// quality rather than being squeezed into the old budget (which would have
// traded sharpness for compression artefacts — the opposite of the point).
const MAX_EDGE = 2560;
const TARGET_BYTES = 2500000; // aim under ~2.5MB (≈ the old bytes-per-pixel at 2560)
const MIN_QUALITY = 0.5;

export async function compressImage(file: File): Promise<File> {
    // Anything already small and in a safe format can go straight through.
    if (file.size <= 900000 && (file.type === 'image/jpeg' || file.type === 'image/png')) {
        return file;
    }

    const bitmap = await loadBitmap(file);

    let width = bitmap.width;
    let height = bitmap.height;

    if (width > MAX_EDGE || height > MAX_EDGE) {
        if (width >= height) {
            height = Math.round((height * MAX_EDGE) / width);
            width = MAX_EDGE;
        } else {
            width = Math.round((width * MAX_EDGE) / height);
            height = MAX_EDGE;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // White behind the image, so a transparent PNG doesn't turn black
    // when it becomes a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap as any, 0, 0, width, height);

    let quality = 0.82;
    let blob = await toBlob(canvas, quality);

    // Step the quality down until it's small enough, but not below a point
    // where it would start to look poor.
    while (blob && blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
        quality = quality - 0.1;
        blob = await toBlob(canvas, quality);
    }

    if (!blob) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

// The photo's natural pixel size, read in the browser — so the quality gate
// (lib/photoRules.photoDimensionProblem) can refuse one that is too small before
// it is compressed or uploaded. Uses the same loader as the shrink, so it copes
// with HEIC from an iPhone too. Returns { width: 0, height: 0 } if it can't be
// read, which the caller treats as "let it through" rather than blocking on a
// reader quirk.
export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
    try {
        const bitmap = await loadBitmap(file);
        return { width: bitmap.width || 0, height: bitmap.height || 0 };
    } catch (err) {
        return { width: 0, height: 0 };
    }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise(function (resolve) {
        canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality);
    });
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
    // createImageBitmap is faster and handles more formats, but isn't
    // everywhere — fall back to a plain Image element.
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(file);
        } catch (err) {
            // fall through
        }
    }

    return new Promise(function (resolve, reject) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read that image'));
        };
        img.src = url;
    });
}

// Shrinks a photo in the browser before it's uploaded.
//
// Phone cameras produce 4–12MB files, and iPhones often produce HEIC, which
// the storage bucket won't take. Drawing the image to a canvas and
// re-exporting solves both: the result is always a reasonably sized JPEG.

const MAX_EDGE = 2000;      // longest side, in pixels
const TARGET_BYTES = 1600000; // aim under ~1.6MB
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

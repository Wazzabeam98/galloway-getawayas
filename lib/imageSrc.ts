// A URL through Next's image optimiser, for the few places that cannot use
// <Image> itself — HTML built as a string (the map popups). Storage photos are
// the host's originals, often 1–2 MB straight off a phone; the optimiser
// resizes and re-encodes them (WebP/AVIF) and caches the result at the edge.
//
// `width` must be one of next.config's deviceSizes or imageSizes, or the
// optimiser answers 400. Next's defaults, which this site uses.
const WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];

export function optimisedSrc(url: string, width: number, quality = 75): string {
    const w = WIDTHS.find((x) => x >= width) ?? 3840;
    return `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=${quality}`;
}

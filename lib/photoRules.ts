// What a listing photo has to be, and the crops it will be shown in — one place,
// so the wizard, the edit screen and the on-screen previews can never disagree
// about it. Kept free of the DOM so it can be unit-tested directly; the one
// browser-only piece (reading a file's pixel size) lives in lib/compressImage.

// Airbnb's bar: a photo must be at least 1024 × 683 px (a 3:2 landscape), or it
// risks looking soft and pixelated once it fills a gallery. We hold to the same
// pixel count in either orientation — a portrait photo passes at 683 × 1024 —
// so the rule is "the longer edge ≥ 1024 and the shorter edge ≥ 683", not a
// demand that every photo be landscape. (Airbnb recommends larger still, around
// 1440 × 960; this is the floor, not the ideal.)
export const MIN_PHOTO_LONG_EDGE = 1024;
export const MIN_PHOTO_SHORT_EDGE = 683;

// Returns a host-readable reason a photo is too small to use, or null when it
// passes. The message names the size needed and the size they gave, so the fix
// is obvious. width/height are the photo's natural pixel dimensions.
export function photoDimensionProblem(width: number, height: number): string | null {
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (!(long >= MIN_PHOTO_LONG_EDGE && short >= MIN_PHOTO_SHORT_EDGE)) {
        return 'That photo is ' + width + ' × ' + height + ' pixels — too small to look sharp. '
            + 'Photos need to be at least ' + MIN_PHOTO_LONG_EDGE + ' × ' + MIN_PHOTO_SHORT_EDGE
            + ' pixels. Please add a larger version.';
    }
    return null;
}

// THE CROPS A GUEST ACTUALLY SEES, so the editor can show a photo cropped the
// way it will really appear rather than in some arbitrary tile.
//
// Both surfaces crop to a fixed height with object-cover, so the real crop is a
// landscape one and the top and bottom of a tall photo are what get lost. These
// are the representative desktop ratios of the two places a photo shows:
//
//   gallery — the listing page's hero/mosaic (components/PhotoGallery), ~3:2.
//   card    — the search / browse result card (components/ListingCard, h-64),
//             a little squarer at ~4:3. Only the COVER photo (images[0]) ever
//             appears here, so the card preview is shown for the cover alone.
//
// Given as CSS aspect-ratio strings so one value drives both the preview boxes
// and any future use, with no second copy to drift.
export const GALLERY_CROP_ASPECT = '3 / 2';
export const CARD_CROP_ASPECT = '4 / 3';

// A host extra's photo (a sauna pack, a hamper) is shown at the same landscape
// 3:2 crop as a listing photo, in both the listing-page section and the booking
// picker — so the editor can preview the exact crop the guest will see. Aliased,
// not a new literal, so there is still one source for the ratio.
export const EXTRA_CROP_ASPECT = GALLERY_CROP_ASPECT;

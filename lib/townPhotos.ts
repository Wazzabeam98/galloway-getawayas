// A town's own photograph — the home page's town tile, the area page's banner
// and its share image — and what is in it. One place, so the tile you click and
// the page it opens always show the same picture. Server-only (reads the disk).

import fs from 'fs';
import path from 'path';

// A town's carousel photo, or null if none has been dropped in yet. Checks the
// filesystem rather than trusting a list, so adding a photo is the only step
// needed to put a town on the home page. The extensions are tried in order and
// the first hit wins; the returned path is what the browser loads.
export const TOWN_PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
export function townPhoto(slug: string): string | null {
    for (const ext of TOWN_PHOTO_EXTS) {
        const rel = '/images/towns/' + slug + '.' + ext;
        if (fs.existsSync(path.join(process.cwd(), 'public', rel))) return rel;
    }
    return null;
}

// What is in each town photograph, written for somebody who cannot see it —
// which also happens to be what Google Images indexes on. The town name is
// deliberately not the whole of it: the name is already the heading right below
// the picture, and repeating it adds nothing, whereas "ruined tower on an
// island, rowing boat, still water" is a description a search can match.
//
// Keyed by the same slug as the file, so a photo and its description are added
// together. A town whose photo has been dropped in without a line here still
// appears — it falls back to naming the town, which is the old behaviour and no
// worse than it was.
export const TOWN_PHOTO_ALT: Record<string, string> = {
    kirkcudbright:
        "The roofless stone shell of MacLellan's Castle standing over the rooftops of "
        + 'whitewashed harbour houses, its empty windows and crow-stepped gables lit by low '
        + 'evening sun against a clear blue sky',
    'castle-douglas':
        'The ruined stone tower of Threave Castle on its island in the River Dee at sunrise, '
        + 'a white clinker-built rowing boat moored on water so still it mirrors the golden '
        + 'reed beds along the bank',
    'gatehouse-of-fleet':
        'The long three-storey grey stone mill at Gatehouse, rows of white sash windows under '
        + 'a slate roof, seen across the Water of Fleet through overhanging summer trees and '
        + 'reflected in the river',
    wanlockhead:
        'Stone cottages and white-harled houses scattered along the floor of a high valley, '
        + 'beneath a steep heather hillside lit gold and green by low sun, with bare moorland '
        + 'hills fading into the distance',
    dalbeattie:
        'A gravel path curving away through tall moss-footed conifers in Dalbeattie forest, '
        + 'low sun throwing long shadows across fallen leaves, with a loch showing through the '
        + 'trunks ahead',
};

export function townPhotoAlt(slug: string, name: string): string {
    return TOWN_PHOTO_ALT[slug] || name + ', Dumfries & Galloway';
}

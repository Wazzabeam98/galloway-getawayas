// The <title> for a listing page, kept short enough that Google shows it whole.
//
// Google cuts a title at roughly 580px — about 60 characters — and SEO
// checkers flag anything longer. The old tag was always
// "<host's title> | Self Catering in <town> | Galloway Getaways", which on
// real listings ran to 79–113 characters: every one truncated, and the cut
// usually fell on the town, the part people search for.
//
// So the longest of these that fits wins, in this order:
//   1. "<title> | Self Catering in <town> | Galloway Getaways"
//   2. "<title> | Self Catering in <town>"
//   3. "<title>, <town>"   (or just "<title>" when it already names the town)
//   4. the title clamped to fit, as a last resort.
// Returned as an ABSOLUTE title, so the root layout's "| Galloway Getaways"
// template is not appended a second time.
//
// Airbnb, for comparison, does not keep under 60 — its tags run
// "<title> - <Type>s for Rent in <Town>, Scotland, United Kingdom - Airbnb"
// and Google rewrites them. A small site cannot rely on being rewritten
// generously, so this keeps the host's words and the town visible instead.
export const TITLE_MAX = 60;
const BRAND = 'Galloway Getaways';

export function listingSeoTitle(hostTitle: string | null | undefined, town: string): string {
    const t = String(hostTitle || '').replace(/\s+/g, ' ').trim() || `Self catering in ${town}`;
    const candidates = [
        `${t} | Self Catering in ${town} | ${BRAND}`,
        `${t} | Self Catering in ${town}`,
        t.toLowerCase().indexOf(town.toLowerCase()) === -1 ? `${t}, ${town}` : t,
        t,
    ];
    for (const c of candidates) if (c.length <= TITLE_MAX) return c;
    return t.slice(0, TITLE_MAX - 1).trimEnd() + '…';
}

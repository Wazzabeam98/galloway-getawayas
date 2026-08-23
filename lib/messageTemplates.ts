// Which template wins for a given booking.
//
// A host with three cottages needs three different check-in messages — where
// the lockbox is, which door, the parking, the directions. So there can be
// several templates of one type, each scoped to listings, and something has to
// decide which one a particular booking gets.
//
// The rule lives here rather than in the cron because two places ask it: the
// scheduled sender, and the inline welcome posted the moment a host accepts.
// Two implementations would eventually disagree, and the disagreement would
// look like a guest getting another property's door code.

export interface ScopedTemplate {
    id: string;
    user_id: string;
    template_type: string;
    body: string;
    enabled: boolean;
    anchor: string | null;
    days_offset: number | null;
    send_hour: number | null;
    minutes_after: number | null;
    hours_after: number | null;
    hours_before: number | null;
    created_at?: string | null;
    // Listings this template is scoped to. Empty means it is the catch-all for
    // every listing the host has — which is what an untouched template is, and
    // what most hosts with one property will always have.
    listingIds: string[];
}

export function isCatchAll(template: ScopedTemplate): boolean {
    return !template.listingIds || template.listingIds.length === 0;
}

export function coversListing(template: ScopedTemplate, listingId: string): boolean {
    if (isCatchAll(template)) return true;
    return template.listingIds.indexOf(listingId) !== -1;
}

// Exactly one template, or none.
//
// Most specific wins: a template naming this listing beats one left open to
// everything. That is how a host thinks about it — a general default, overridden
// for the cottage that is different — and it means a guest gets one check-in
// message rather than two, which matters more than any of it.
//
// Two templates of a type both naming the same listing is refused by the
// database, so the tie-break below should never be reached. It exists because
// "should never" is not "cannot": if a row survives from before the constraint,
// or somebody works around it, the run must still be deterministic. Oldest
// wins — an arbitrary rule, but the same arbitrary rule every time, rather than
// whichever the query happened to return first.
export function resolveTemplate(
    templates: ScopedTemplate[],
    templateType: string,
    listingId: string
): ScopedTemplate | null {
    const candidates = templates.filter(function (t) {
        return t.template_type === templateType
            && t.enabled
            && coversListing(t, listingId);
    });

    if (candidates.length === 0) return null;

    const specific = candidates.filter(function (t) { return !isCatchAll(t); });
    const pool = specific.length > 0 ? specific : candidates;

    if (pool.length === 1) return pool[0];

    return pool.slice().sort(function (a, b) {
        const at = String(a.created_at || '');
        const bt = String(b.created_at || '');
        if (at !== bt) return at < bt ? -1 : 1;
        // created_at can tie to the millisecond on a bulk insert.
        return String(a.id) < String(b.id) ? -1 : 1;
    })[0];
}

// True when more than one template of a type explicitly names this listing —
// the state the database refuses. Surfaced so owner-facing screens can say so
// rather than quietly picking one.
export function hasScopeClash(
    templates: ScopedTemplate[],
    templateType: string,
    listingId: string
): boolean {
    return templates.filter(function (t) {
        return t.template_type === templateType
            && !isCatchAll(t)
            && t.listingIds.indexOf(listingId) !== -1;
    }).length > 1;
}

export type CoverageState = 'specific' | 'default' | 'none' | 'disabled';

export interface CoverageCell {
    listingId: string;
    templateType: string;
    state: CoverageState;
    templateId: string | null;
}

// What covers each listing, for each type — the grid a host reads to find the
// gap. Somebody with three properties and four kinds of message is looking at
// twelve answers, and the one that matters is the empty one.
export function coverage(
    templates: ScopedTemplate[],
    listingIds: string[],
    templateTypes: string[]
): CoverageCell[] {
    const cells: CoverageCell[] = [];

    listingIds.forEach(function (listingId) {
        templateTypes.forEach(function (templateType) {
            const winner = resolveTemplate(templates, templateType, listingId);

            if (winner) {
                cells.push({
                    listingId: listingId,
                    templateType: templateType,
                    state: isCatchAll(winner) ? 'default' : 'specific',
                    templateId: winner.id,
                });
                return;
            }

            // Nothing enabled covers it. Worth telling apart: a template that
            // exists but is switched off is a decision, and no template at all
            // is usually an oversight.
            const disabled = templates.some(function (t) {
                return t.template_type === templateType
                    && !t.enabled
                    && coversListing(t, listingId);
            });

            cells.push({
                listingId: listingId,
                templateType: templateType,
                state: disabled ? 'disabled' : 'none',
                templateId: null,
            });
        });
    });

    return cells;
}

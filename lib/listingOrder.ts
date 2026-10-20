// The one place the public display order lives.
//
// The admin "Arrange listings" tool (app/admin/arrange) writes a number into
// listings.display_order / service_providers.display_order; lower sorts earlier,
// NULL sorts last (a row never placed, e.g. a brand-new listing, falls to the
// bottom until the owner moves it). Every public grid orders the SAME way so the
// arrange page is the single source of truth and the order can't drift between
// the home page, the search/browse results and the area pages:
//
//   display_order ASC NULLS LAST, then the grid's own existing tie-break.
//
// Cottages tie-break by created_at DESC (what every listings grid did before this
// column existed); experiences, which sort in JS, tie-break by photo-first then
// name (what lib/experiencesData did before). Those tie-breaks only ever decide
// the order WITHIN the not-yet-placed (NULL) group — placed rows have distinct
// numbers.

// The column every grid reads and the arrange tool writes. Not sensitive: a
// position in a public list. `listings` grants it SELECT to anon/authenticated so
// the cottage grids (read as the browser role) can ORDER BY it; the experiences
// grid reads service_providers with the service role, so its copy stays
// server-only. See 20261020205644_listings_and_providers_display_order.sql.
export const DISPLAY_ORDER_COLUMN = 'display_order';

// Apply the shared order to a PostgREST query on a table that has display_order
// plus created_at (the cottage grids: home page + area pages). Two .order() calls
// in one place, so the home grid and every area page sort identically.
//
// `nullsFirst: false` puts the un-placed rows (NULL) after the placed ones, and
// created_at DESC is the within-NULL tie-break that was the whole order before.
export function orderPublishedListings<Q extends {
    order: (column: string, opts: { ascending: boolean; nullsFirst?: boolean }) => Q;
}>(query: Q): Q {
    return query
        .order(DISPLAY_ORDER_COLUMN, { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
}

// The JS comparator for grids sorted in code (experiences). Placed rows first, in
// ascending display_order; un-placed rows (NULL/undefined) last, ordered among
// themselves by the caller's existing tie-break.
export function byDisplayOrder<T extends { display_order?: number | null }>(
    tieBreak: (a: T, b: T) => number,
): (a: T, b: T) => number {
    return (a, b) => {
        const ao = a.display_order;
        const bo = b.display_order;
        const an = ao === null || ao === undefined;
        const bn = bo === null || bo === undefined;
        if (an !== bn) return an ? 1 : -1; // nulls last
        if (!an && !bn && ao !== bo) return (ao as number) - (bo as number);
        return tieBreak(a, b); // both placed-and-equal (shouldn't happen) or both NULL
    };
}

// The head count of an experience order, once its top-ups are folded in.
//
// A per-person slot booking can grow by buying more places (see the
// 20260920120000 migration): each added place is a CHILD service_orders row
// linked by parent_order_id, with its own seats and its own charge. The
// original row's quantity/price is never rewritten, so no single row knows the
// real party any more — the truth is the parent plus its CONFIRMED children.
//
// This is the one place that arithmetic lives. Every reader that shows "how
// many are coming" or "the total paid" folds the family through here: the order
// page's party line, the provider dashboard rows (via /api/services/orders),
// and — mirrored in SQL because a Postgres function cannot call TypeScript — the
// ensure_order_seats invite cap. Keeping it in one function is what stops the
// invite list, the guest's page and the provider's diary quietly disagreeing.
//
// Deliberately NOT a money-path file: it sums a price for DISPLAY, but it moves
// nothing and decides no charge. The charge for each place is struck once, on
// its own row, by the top-up route through priceOrder.

export interface FamilyRow {
    // A per-person order carries its head count in quantity; a private one in
    // attendees. Both may be null on a malformed row — treated as zero seats.
    quantity?: number | null;
    attendees?: number | null;
    // The adults/children split, or null when none was recorded for this row.
    adults?: number | null;
    children?: number | null;
    // For DISPLAY only (the booker's "new total"). A companion never has this.
    price?: number | null;
    item_unit?: string | null;
}

export interface FoldedFamily {
    // The seats the provider is setting out for: the original plus every
    // confirmed added place.
    headcount: number;
    // The summed split, or null when it cannot be trusted — if any row in the
    // family recorded no split, a partial sum would understate the party, so the
    // whole thing collapses to null ("not recorded") rather than a wrong number.
    adults: number | null;
    children: number | null;
    // The summed price across the family, for the booker's view. Null when no
    // row carried a price (a money-stripped, companion-facing fold).
    total: number | null;
    // How many of the seats came from top-ups (0 on an order with none).
    addedSeats: number;
}

// The head count on one row: a per-person order's quantity, else a private
// order's attendees, else zero.
function rowSeats(row: FamilyRow): number {
    const q = Number(row.quantity);
    if (Number.isFinite(q) && q > 0) return q;
    const a = Number(row.attendees);
    if (Number.isFinite(a) && a > 0) return a;
    return 0;
}

/**
 * Fold a parent order and its CONFIRMED top-up children into one head count,
 * split and total. Pass only confirmed children — a holding or expired top-up
 * has taken no paid seat and must not count. An order with no children folds to
 * itself.
 */
export function foldOrderFamily(parent: FamilyRow, confirmedChildren: FamilyRow[] = []): FoldedFamily {
    const rows = [parent, ...confirmedChildren];

    const headcount = rows.reduce((sum, r) => sum + rowSeats(r), 0);
    const addedSeats = confirmedChildren.reduce((sum, r) => sum + rowSeats(r), 0);

    // The split only sums if every row recorded one; otherwise it is unknown.
    const everyRowHasSplit = rows.every((r) => r.adults != null || r.children != null);
    let adults: number | null = null;
    let children: number | null = null;
    if (everyRowHasSplit) {
        adults = rows.reduce((sum, r) => sum + (Number(r.adults) || 0), 0);
        children = rows.reduce((sum, r) => sum + (Number(r.children) || 0), 0);
    }

    const anyPrice = rows.some((r) => r.price != null);
    const total = anyPrice
        ? Math.round(rows.reduce((sum, r) => sum + (Number(r.price) || 0), 0) * 100) / 100
        : null;

    return { headcount, adults, children, total, addedSeats };
}

/**
 * An order-shaped object with its head count, split and price replaced by the
 * folded family values, so a renderer written for a single row (countLine,
 * partyText, the order page party line) shows the whole party unchanged. Only
 * the four folded fields are overwritten; everything else on the parent is kept.
 */
export function withFamilyFolded<T extends FamilyRow>(parent: T, confirmedChildren: FamilyRow[] = []): T {
    const folded = foldOrderFamily(parent, confirmedChildren);
    const out: any = { ...parent };
    // A per-person order carries its count in quantity; leave a private order's
    // attendees as the head count instead of moving it onto quantity.
    if (parent.item_unit === 'person') out.quantity = folded.headcount;
    else if (parent.attendees != null) out.attendees = folded.headcount;
    out.adults = folded.adults;
    out.children = folded.children;
    if (folded.total != null) out.price = folded.total;
    return out as T;
}

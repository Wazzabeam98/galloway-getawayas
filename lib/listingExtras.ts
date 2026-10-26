// Host-sold optional extras on a stay (Stage 1): the vocabulary and the rules,
// in one place the editor (as the host types), the booking card and the
// checkout route all read, so the browser and the server can never disagree
// about what a valid extra is or what it costs.
//
// The arithmetic is NOT here — a total is worked out only in lib/pricing.ts.
// This holds what an extra IS (its shape and limits) and how a stored catalogue
// row plus a guest's chosen quantity become the priced line pricing.ts sums.

export type ExtraUnit = 'stay' | 'night' | 'person';
export type ExtraVat = 'standard' | 'zero';

export const EXTRA_UNITS: ExtraUnit[] = ['stay', 'night', 'person'];
export const EXTRA_VAT: ExtraVat[] = ['standard', 'zero'];

export const EXTRA_LABEL_MAX = 80;
export const EXTRA_DESCRIPTION_MAX = 300;
// A ceiling, so a slipped decimal ("1500" for £15.00) is caught rather than
// charged. Well above any real sauna pack or hamper.
export const EXTRA_MAX_PRICE = 1000;

// How many of one extra a guest may add when the host sets no cap of their own.
// The stepper stops here and resolveSelection clamps to it, so the two always
// agree. A host's own max_qty, when set, overrides it (never above the ceiling).
export const EXTRA_DEFAULT_QTY_CAP = 10;
// The hard ceiling for a host-set max_qty, matching the DB CHECK constraint.
export const EXTRA_MAX_QTY_CEILING = 99;

// The quantity cap for one catalogue row: the host's max_qty when they set one
// (never above the ceiling), otherwise the platform default. The ONE place the
// stepper and the server both read, so a guest can never buy past the cap.
export function extraQtyCap(extra: { max_qty?: number | null } | null | undefined): number {
    const set = Number(extra && extra.max_qty);
    if (set > 0) return Math.min(Math.floor(set), EXTRA_MAX_QTY_CEILING);
    return EXTRA_DEFAULT_QTY_CAP;
}

// A row of the host's catalogue, as stored in listing_extras.
export interface ListingExtra {
    id: string;
    listing_id?: string;
    label: string;
    description?: string | null;
    price: number;
    unit: ExtraUnit;
    vat_treatment: ExtraVat;
    active?: boolean;
    sort_order?: number | null;
    // The storage PATH of an optional photo (display only — never read by the
    // price or the payout). The public URL is derived from it by getImageUrl.
    photo?: string | null;
    // An optional per-extra quantity cap. Null = the platform default
    // (EXTRA_DEFAULT_QTY_CAP). See extraQtyCap.
    max_qty?: number | null;
}

// The guest's claim, written onto the booking at insert: which extra, how many.
// No price — the price is always read back from the catalogue, never from here.
export interface ExtraSelection {
    extra_id: string;
    qty: number;
}

export function unitLabel(unit: ExtraUnit): string {
    if (unit === 'night') return 'per night';
    if (unit === 'person') return 'per person';
    return 'per stay';
}

export function vatLabel(vat: ExtraVat): string {
    return vat === 'zero' ? 'Zero-rated (no VAT)' : 'Standard-rated (20% VAT)';
}

// The host's catalogue, validated. Returns null when the row is good, or the
// sentence to show beside the offending field — the same messages the DB CHECK
// constraints enforce server-side (see 20261008120000_host_extras_stage1).
export function extraProblem(input: {
    label?: unknown;
    description?: unknown;
    price?: unknown;
    unit?: unknown;
    vat_treatment?: unknown;
    max_qty?: unknown;
}): string | null {
    const label = String(input.label ?? '').trim();
    if (!label) return 'Give the extra a name, like “Sauna pack”.';
    if (label.length > EXTRA_LABEL_MAX) return 'Keep the name to ' + EXTRA_LABEL_MAX + ' characters.';

    const description = input.description == null ? '' : String(input.description);
    if (description.length > EXTRA_DESCRIPTION_MAX) {
        return 'Keep the description to ' + EXTRA_DESCRIPTION_MAX + ' characters.';
    }

    const price = Number(input.price);
    if (!(price > 0)) return 'Set a price above £0.';
    if (price > EXTRA_MAX_PRICE) return 'That price looks too high — check the decimal point.';

    if (!EXTRA_UNITS.includes(input.unit as ExtraUnit)) return 'Choose per stay, per night or per person.';
    if (!EXTRA_VAT.includes(input.vat_treatment as ExtraVat)) return 'Choose a VAT treatment.';

    // max_qty is optional; when given it must be a whole number in range.
    if (input.max_qty != null && String(input.max_qty).trim() !== '') {
        const cap = Number(input.max_qty);
        if (!Number.isInteger(cap) || cap < 1 || cap > EXTRA_MAX_QTY_CEILING) {
            return 'A maximum quantity must be a whole number from 1 to ' + EXTRA_MAX_QTY_CEILING + ', or left blank.';
        }
    }

    return null;
}

// A catalogue row plus a chosen quantity, as the one shape pricing.ts prices.
// Price, unit and VAT come from the catalogue row (authoritative); only the
// quantity comes from the guest. An inactive extra, an unknown id or a
// non-positive quantity yields nothing — a selection can never conjure a line
// that is not a live extra on this listing.
export interface QuoteExtra {
    id: string;
    label: string;
    unit: ExtraUnit;
    unitPrice: number;
    qty: number;
    vat_treatment: ExtraVat;
}

// Turn the guest's selection into priceable extras, read back against the
// listing's live catalogue. This is the ONE mapping the booking card and the
// checkout route both call, so the price shown and the price charged are built
// the same way from the same source.
export function resolveSelection(
    selection: ExtraSelection[] | null | undefined,
    catalogue: ListingExtra[] | null | undefined
): QuoteExtra[] {
    if (!Array.isArray(selection) || !selection.length) return [];
    const byId = new Map<string, ListingExtra>();
    (catalogue || []).forEach((e) => {
        if (e && e.id && e.active !== false) byId.set(String(e.id), e);
    });

    const out: QuoteExtra[] = [];
    for (const sel of selection) {
        if (!sel) continue;
        const extra = byId.get(String(sel.extra_id));
        if (!extra) continue; // unknown id, or inactive — not a live extra
        // Clamp to the catalogue's cap server-side, mirroring the stepper, so a
        // tampered selection can never buy past the host's maximum.
        const qty = Math.min(Math.floor(Number(sel.qty) || 0), extraQtyCap(extra));
        if (!(qty > 0)) continue;
        const price = Number(extra.price) || 0;
        if (!(price > 0)) continue;
        out.push({
            id: String(extra.id),
            label: String(extra.label),
            unit: normaliseUnit(extra.unit),
            unitPrice: price,
            qty,
            vat_treatment: extra.vat_treatment === 'zero' ? 'zero' : 'standard',
        });
    }
    return out;
}

// One place that maps any stored/claimed unit to a known one. An unrecognised
// value falls back to 'stay' — the safe default (charged once).
export function normaliseUnit(unit: unknown): ExtraUnit {
    if (unit === 'night') return 'night';
    if (unit === 'person') return 'person';
    return 'stay';
}

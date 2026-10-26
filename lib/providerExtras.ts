// Guest-selectable paid extras on an EXPERIENCE/SERVICE order — the provider
// equivalent of lib/listingExtras. One place the provider editor (as they
// type), the guest order panel and the order route all read, so the browser
// and the server can never disagree about what a valid extra is or costs.
//
// Shared with the stays model where it is genuinely the same: the length and
// price limits, the quantity-cap rule. What differs is real:
//   * units are 'booking' (charged once) or 'person' (once per guest). There is
//     no 'night' — a night is a stay concept.
//   * the price itself is summed here (priceProviderExtras), because an
//     experience order has no shared pricing engine like lib/pricing.ts; this
//     IS that one place for an extra.
//   * commission is taken on a provider extra exactly as on the experience.

import {
    EXTRA_LABEL_MAX, EXTRA_DESCRIPTION_MAX, EXTRA_MAX_PRICE,
    EXTRA_DEFAULT_QTY_CAP, EXTRA_MAX_QTY_CEILING, extraQtyCap,
    type ExtraVat,
} from './listingExtras';

export { EXTRA_LABEL_MAX, EXTRA_DESCRIPTION_MAX, EXTRA_MAX_PRICE, EXTRA_DEFAULT_QTY_CAP, EXTRA_MAX_QTY_CEILING, extraQtyCap };
export type { ExtraVat };

export type ProviderExtraUnit = 'booking' | 'person';
export const PROVIDER_EXTRA_UNITS: ProviderExtraUnit[] = ['booking', 'person'];
export const PROVIDER_EXTRA_VAT: ExtraVat[] = ['standard', 'zero'];

// A row of the provider's catalogue, as stored in provider_extras.
export interface ProviderExtra {
    id: string;
    provider_id?: string;
    label: string;
    description?: string | null;
    price: number;
    unit: ProviderExtraUnit;
    vat_treatment: ExtraVat;
    active?: boolean;
    sort_order?: number | null;
    max_qty?: number | null;
    photo?: string | null;
}

// The guest's claim, sent to the order route: which extra, how many. No price —
// the price is always read back from the catalogue, never from here.
export interface ProviderExtraSelection {
    extra_id: string;
    qty: number;
}

export function providerUnitLabel(unit: ProviderExtraUnit): string {
    return unit === 'person' ? 'per person' : 'per booking';
}

export function providerVatLabel(vat: ExtraVat): string {
    return vat === 'zero' ? 'Zero-rated (no VAT)' : 'Standard-rated (20% VAT)';
}

export function normaliseProviderUnit(unit: unknown): ProviderExtraUnit {
    return unit === 'person' ? 'person' : 'booking';
}

// The provider's catalogue row, validated. Returns null when good, or the
// sentence to show beside the offending field — the same messages the DB CHECK
// constraints enforce server-side.
export function providerExtraProblem(input: {
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

    if (!PROVIDER_EXTRA_UNITS.includes(input.unit as ProviderExtraUnit)) return 'Choose per booking or per person.';
    if (!PROVIDER_EXTRA_VAT.includes(input.vat_treatment as ExtraVat)) return 'Choose a VAT treatment.';

    if (input.max_qty != null && String(input.max_qty).trim() !== '') {
        const cap = Number(input.max_qty);
        if (!Number.isInteger(cap) || cap < 1 || cap > EXTRA_MAX_QTY_CEILING) {
            return 'A maximum quantity must be a whole number from 1 to ' + EXTRA_MAX_QTY_CEILING + ', or left blank.';
        }
    }

    return null;
}

// A catalogue row plus a chosen quantity, as priceProviderExtras prices it.
export interface ProviderQuoteExtra {
    id: string;
    label: string;
    unit: ProviderExtraUnit;
    unitPrice: number;
    qty: number;
    vat_treatment: ExtraVat;
}

// One priced extra line, frozen onto the order (extras_breakdown).
export interface ProviderExtraLine {
    id: string;
    label: string;
    unit: ProviderExtraUnit;
    unitPrice: number;
    qty: number;
    // How many units were multiplied: the guest count for a per-person extra, 1
    // for a per-booking one.
    units: number;
    lineTotal: number;
    vat_treatment: ExtraVat;
}

function money(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
}

// Turn the guest's selection into priceable extras, read back against the
// provider's live catalogue. The ONE mapping the order panel and the order
// route both call, so the price shown and the price charged are built the same
// way from the same source. Clamps quantity to the catalogue's cap server-side,
// so a tampered selection can never buy past the provider's maximum.
export function resolveProviderSelection(
    selection: ProviderExtraSelection[] | null | undefined,
    catalogue: ProviderExtra[] | null | undefined
): ProviderQuoteExtra[] {
    if (!Array.isArray(selection) || !selection.length) return [];
    const byId = new Map<string, ProviderExtra>();
    (catalogue || []).forEach((e) => {
        if (e && e.id && e.active !== false) byId.set(String(e.id), e);
    });

    const out: ProviderQuoteExtra[] = [];
    for (const sel of selection) {
        if (!sel) continue;
        const extra = byId.get(String(sel.extra_id));
        if (!extra) continue; // unknown id, or inactive — not a live extra
        const qty = Math.min(Math.floor(Number(sel.qty) || 0), extraQtyCap(extra));
        if (!(qty > 0)) continue;
        const price = Number(extra.price) || 0;
        if (!(price > 0)) continue;
        out.push({
            id: String(extra.id),
            label: String(extra.label),
            unit: normaliseProviderUnit(extra.unit),
            unitPrice: price,
            qty,
            vat_treatment: extra.vat_treatment === 'zero' ? 'zero' : 'standard',
        });
    }
    return out;
}

// The order route freezes the chosen extras onto the Stripe metadata as a
// compact string, "id:qty:unit:units:unitPrice:vat,...", to stay under the
// 500-char limit. requestOrder rebuilds the order's extras_breakdown from it
// (the label re-read from the catalogue, passed here as labelsById). Pure, so
// the round-trip can be tested without a webhook: the frozen unitPrice and
// units are trusted (they were priced server-side at checkout), so a later
// catalogue edit cannot change what a paid order shows or summed to.
export function parseFrozenExtras(
    extrasStr: string | null | undefined,
    labelsById: Record<string, string>
): { breakdown: ProviderExtraLine[]; selection: ProviderExtraSelection[]; total: number } {
    const parts = String(extrasStr || '').split(',').map((s) => s.split(':')).filter((a) => a[0]);
    const breakdown: ProviderExtraLine[] = parts.map((a) => {
        const [id, qty, unit, units, unitPrice, vat] = a;
        const q = Math.max(1, parseInt(qty, 10) || 1);
        const u = Math.max(1, parseInt(units, 10) || 1);
        const up = Number(unitPrice) || 0;
        return {
            id,
            label: labelsById[id] || 'Extra',
            unit: normaliseProviderUnit(unit),
            unitPrice: up,
            qty: q,
            units: u,
            lineTotal: money(up * q * u),
            vat_treatment: vat === 'zero' ? 'zero' : 'standard',
        };
    });
    const selection: ProviderExtraSelection[] = parts.map((a) => ({ extra_id: a[0], qty: Math.max(1, parseInt(a[1], 10) || 1) }));
    const total = money(breakdown.reduce((s, l) => s + Number(l.lineTotal || 0), 0));
    return { breakdown, selection, total };
}

// The one place a provider extra is priced. A per-booking extra is charged once;
// a per-person extra once for each guest on the order (a party of one still pays
// for one). Never discounted. Each line carries its VAT treatment, frozen for
// the receipt. `guests` is the number of people on the order.
export function priceProviderExtras(
    resolved: ProviderQuoteExtra[] | null | undefined,
    guests: number
): { lines: ProviderExtraLine[]; total: number } {
    const head = Math.max(1, Math.floor(Number(guests) || 1));
    const lines: ProviderExtraLine[] = [];
    let total = 0;
    for (const e of resolved || []) {
        if (!e) continue;
        const qty = Math.floor(Number(e.qty) || 0);
        const unitPrice = Number(e.unitPrice) || 0;
        if (!(qty > 0) || !(unitPrice > 0)) continue;
        const units = e.unit === 'person' ? head : 1;
        const lineTotal = money(unitPrice * qty * units);
        lines.push({
            id: String(e.id),
            label: String(e.label),
            unit: normaliseProviderUnit(e.unit),
            unitPrice: money(unitPrice),
            qty,
            units,
            lineTotal,
            vat_treatment: e.vat_treatment === 'zero' ? 'zero' : 'standard',
        });
        total += lineTotal;
    }
    return { lines, total: money(total) };
}

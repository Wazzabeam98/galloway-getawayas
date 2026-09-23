// Extra-guests pricing for a group-priced (flat) experience item.
//
// A flat item has a base price that includes `included_guests` heads. A larger
// party pays a per-head fee on top — extra_adult_fee per extra adult and, where
// the provider's minimum age admits children, extra_child_fee per extra child —
// up to `max_party`. The price NEVER drops below the base: a party at or under
// the included number still pays exactly the base.
//
// An item with `included_guests` unset has no extra-guests pricing and behaves
// exactly as a plain flat price: one price, party size is metadata only.

import { normaliseUnit } from './serviceOrders';
import { childrenAllowed } from './guestAges';

export interface ExtraGuestsItem {
    unit?: string | null;
    price?: number | string | null;
    included_guests?: number | null;
    extra_adult_fee?: number | string | null;
    extra_child_fee?: number | string | null;
    max_party?: number | null;
}

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));

/** True when this flat item charges for a larger party. */
export function hasExtraGuests(item: ExtraGuestsItem | null | undefined): boolean {
    if (!item) return false;
    if (normaliseUnit(item.unit) !== 'flat') return false;
    const included = num(item.included_guests);
    if (included < 1) return false;
    return num(item.extra_adult_fee) > 0 || num(item.extra_child_fee) > 0;
}

/** The party ceiling: max_party if set, else the included number (no extras). */
export function partyCeiling(item: ExtraGuestsItem | null | undefined): number {
    if (!hasExtraGuests(item)) return Infinity;
    const included = num(item!.included_guests);
    const max = num(item!.max_party);
    return max >= included ? max : included;
}

// The price for a party of `adults` + `children`. The included allowance covers
// ADULTS first (the pricier head), so any extras are the cheaper children before
// adults — the guest-favourable reading. Never below the base, and children are
// only ever charged where the minimum age admits them.
export function partyPrice(
    item: ExtraGuestsItem,
    adults: number,
    children: number,
    minAge: number | null | undefined
): number {
    const base = num(item.price);
    if (!hasExtraGuests(item)) return base;
    const a = Math.max(0, Math.floor(adults) || 0);
    const kidsOk = childrenAllowed(minAge ?? null);
    const c = kidsOk ? Math.max(0, Math.floor(children) || 0) : 0;
    const included = num(item.included_guests);

    const includedAdults = Math.min(a, included);
    const includedChildren = Math.min(c, included - includedAdults);
    const extraAdults = a - includedAdults;
    const extraChildren = c - includedChildren;

    const total = base
        + extraAdults * num(item.extra_adult_fee)
        + extraChildren * num(item.extra_child_fee);
    return Math.round(Math.max(base, total) * 100) / 100;
}

const money = (n: number): string => '£' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');

// The listing line, e.g. "£220 for up to 4, +£40 per extra adult" (and
// "+£15 per extra child" where children are allowed). Null when the item has no
// extra-guests pricing — the caller then shows its plain price.
export function extraGuestsLine(item: ExtraGuestsItem, minAge: number | null | undefined): string | null {
    if (!hasExtraGuests(item)) return null;
    const included = num(item.included_guests);
    const parts = [money(num(item.price)) + ' for up to ' + included];
    const adultFee = num(item.extra_adult_fee);
    if (adultFee > 0) parts.push('+' + money(adultFee) + ' per extra adult');
    if (childrenAllowed(minAge ?? null) && num(item.extra_child_fee) > 0) {
        parts.push('+' + money(num(item.extra_child_fee)) + ' per extra child');
    }
    return parts.join(', ');
}

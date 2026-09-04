// Small, display-only helpers for the trip cards. Deliberately NOT in
// lib/cancellation.ts: that file is a watched money path (its fingerprint guard
// trips on any edit), and these are copy/format helpers with no bearing on what
// a guest is charged or refunded. We only READ policyOf from there.

import { policyOf, type PolicyKey } from './cancellation';

// The party as a person would say it — "3 adults · 1 child · 1 pet". The split
// (adults/children/pets) is written onto every booking at checkout, so this is a
// pure display of data already on the row. Where an older booking has no split
// stored, we fall back to the plain guests total so the card never goes blank.
// Infants are deliberately absent: the booking widget never collected them, so
// there is nothing to show.
export function partyLabel(b: {
    adults?: number | null;
    children?: number | null;
    pets?: number | null;
    guests?: number | null;
}): string | null {
    const adults = Number(b.adults || 0);
    const children = Number(b.children || 0);
    const pets = Number(b.pets || 0);

    const parts: string[] = [];
    if (adults > 0) parts.push(adults + (adults === 1 ? ' adult' : ' adults'));
    if (children > 0) parts.push(children + (children === 1 ? ' child' : ' children'));
    if (pets > 0) parts.push(pets + (pets === 1 ? ' pet' : ' pets'));
    if (parts.length) return parts.join(' · ');

    // No split on the row — a legacy booking taken before the columns were
    // written. Show the total we do have.
    const guests = Number(b.guests || 0);
    if (guests > 0) return guests + (guests === 1 ? ' guest' : ' guests');
    return null;
}

// A human-readable confirmation number DERIVED from the booking's UUID, so there
// is no new column and no migration. Stable for a given booking. If email or
// support ever needs to quote it, promote it to a real stored reference then —
// until that day this is display only.
export function confirmationNumber(bookingId: string): string {
    const hex = String(bookingId).replace(/[^0-9a-fA-F]/g, '').slice(0, 8).toUpperCase();
    return 'GG-' + (hex || 'PENDING');
}

// The cancellation policy said plainly, for the card — the same four tiers as
// lib/cancellation.ts's RULES, in words. This is the STANDING policy, distinct
// from the live "free to cancel until…" position the card already computes; the
// two sit together the way terms and your current standing do.
const POLICY_WORDS: Record<PolicyKey, string> = {
    Flexible: 'Full refund up to a day before check-in.',
    Moderate: 'Full refund up to 5 days before check-in.',
    Limited: 'Full refund up to 14 days before check-in, then 50% up to 7 days before.',
    Firm: 'Full refund up to 30 days before check-in, then 50% up to 7 days before.',
};

export function cancellationWords(policy: string | null | undefined): { tier: PolicyKey; summary: string } {
    const tier = policyOf(policy);
    return { tier, summary: POLICY_WORDS[tier] };
}

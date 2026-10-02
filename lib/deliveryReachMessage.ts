import type { ReachDecision } from '@/lib/postcodeGeocode';

// The guest-facing reason a delivery/travelling order was refused for being out
// of the provider's reach — shown BEFORE payment, never as a failed checkout.
//
// This used to live inside app/api/services/order/route.ts as a private
// function. It moved here when the guest delivery-address modal grew a preflight
// (app/api/services/delivery-reach) that checks the SAME reach at the moment the
// address is saved, so a bad postcode is refused in the modal rather than only
// at the Pay button. Both callers must say the same thing — one copy, one place,
// so the two can never drift.
//
// `verb` is "deliver" or "travel" so the one message fits a delivering baker and
// a chef who comes to the cottage alike.
//
// Takes the whole ReachDecision (not just the refusal variant) so both callers
// can hand it their value without fighting the compiler's narrowing — an `ok`
// decision has no message and returns '' (callers only reach here on a refusal).
export function outOfReachMessage(
    d: ReachDecision,
    who: string,
    radiusMiles: number,
    verb: 'deliver' | 'travel',
): string {
    if (d.ok) return '';
    // Narrowing on the boolean discriminant is unreliable when the test build
    // compiles without strictNullChecks, so name the refusal shape explicitly
    // after the ok guard above has already ruled out the success variant.
    const f = d as { ok: false; reason: 'unplaceable' | 'out_of_region' | 'too_far'; miles: number | null };
    if (f.reason === 'unplaceable') return 'We couldn’t place that postcode. Please check it, or arrange collection instead.';
    if (f.reason === 'out_of_region') return `Sorry — ${who} only ${verb}s within Dumfries & Galloway.`;
    const r = Math.round(Number(radiusMiles) || 0);
    const m = f.miles != null ? Math.round(f.miles) : null;
    return `Sorry — ${who} only ${verb}s within ${r} mile${r === 1 ? '' : 's'}`
        + (m != null ? `, and that address is about ${m} miles away` : '')
        + `. You could collect instead.`;
}

// How an experience offering is charged — the unit model (Liam, 9 Oct 2026).
//
// Five units a provider can choose, each a word they recognise:
//
//   person  Per person  — a price each; multiplies by the party.
//   flat    Per group   — one price for the booking, charged once.
//   event   Per event   — one price for the event, charged once. The same money
//                         as 'flat', a different meaning: a bouncy castle or a
//                         pop-up bar is per event however many turn up, so a
//                         per-event provider is never asked for a capacity.
//   item    Per item    — a price for each one.
//   hour    Per hour    — comes-to-you only (stage two; not offered yet).
//
// Ranges and price on enquiry were dropped (9 Oct 2026). price_mode/price_max
// stay on the table but are no longer written; only a fixed price is listed.
//
// Which units a provider is offered depends on how they are booked (the shape):
//   - a group session (sauna, tasting, walk): per person and/or per group — the
//     seat machinery knows only those two;
//   - a timed one-at-a-time treatment (massage): not asked — one price for a set
//     length, shown as "£60 · 1 hr";
//   - comes to you (chef, oysters, guide): per person, per group, per event, per item;
//   - made to order (food): per item, not asked.
//
// Pure: no database, no React, so the wizard, the editor, the save route and the
// marketplace all read one set of rules.

export type ChargeUnit = 'person' | 'flat' | 'event' | 'item' | 'hour';

// The provider-facing name of each unit — the tile label and the summary word.
// Legacy units (night, ticket, and hour until stage two) keep a readable name so
// an offering already priced that way still reads right.
export const UNIT_NAME: Record<string, string> = {
    person: 'Per person',
    flat: 'Per group',
    event: 'Per event',
    item: 'Per item',
    hour: 'Per hour',
    night: 'Per night',
    ticket: 'Per ticket',
};

// The one-line meaning under each tile.
export const UNIT_HINT: Record<string, string> = {
    person: 'A price for each guest.',
    flat: 'One price for the group, up to a number you set.',
    event: 'One price for the event, however many people come.',
    item: 'A price for each one a guest orders.',
    hour: 'A price for each hour a guest books.',
};

// "per person", "per group" — the lower-case phrase for a summary or a sentence.
export function unitPer(unit: string | null | undefined): string {
    const name = UNIT_NAME[String(unit || 'flat')];
    return name ? name.toLowerCase() : '';
}

/** The units a NEW offering may be given, by booking shape. `timed` is the
 *  one-at-a-time treatment shape (massage), which has a single unit and is
 *  never asked. Order is the order the picker shows them. */
export function chargeUnitsFor(shape: string | null | undefined, opts: { timed?: boolean } = {}): ChargeUnit[] {
    if (shape === 'slot') return opts.timed ? ['flat'] : ['person', 'flat'];
    if (shape === 'made_to_order') return ['item'];
    return ['person', 'flat', 'event', 'item'];
}

/** The picker's choices for one offering: the shape's units, plus the row's own
 *  unit when it is a legacy one, so an existing offering is never silently
 *  changed by opening it. */
export function unitChoices(allowed: string[], current: string | null | undefined): string[] {
    const cur = String(current || '');
    return cur && !allowed.includes(cur) ? [...allowed, cur] : [...allowed];
}

/** Whether a provider charging these ways needs a maximum capacity at all. Per
 *  person and per group do (how many places / how big a group); per event and
 *  per item don't — the price is the same however many come. Nothing chosen yet
 *  reads as yes, so the question isn't skipped by accident. */
export function needsCapacity(units: string[] | null | undefined): boolean {
    if (!units || !units.length) return true;
    return units.some((u) => u === 'person' || u === 'flat');
}

/** The guest-facing suffix after a price: "£30 / guest", "£220 / group",
 *  "£475 / event", "£20 / hr". A per-item price reads plainly ("£4"), and so does
 *  a TIMED one-price offering — a treatment's length is its qualifier
 *  ("£60 · 1 hr"), not "/ group". */
export function guestUnitSuffix(unit: string | null | undefined, timed = false): string {
    switch (String(unit || 'flat')) {
        case 'person': return ' / guest';
        case 'flat': return timed ? '' : ' / group';
        case 'event': return ' / event';
        case 'hour': return ' / hr';
        case 'night': return ' / night';
        default: return '';
    }
}

/** The price question, asked after the unit: "How much per person?". A timed
 *  treatment (and anything unrecognised) asks plainly. */
export function priceQuestion(unit: string | null | undefined, timed = false): string {
    if (timed) return 'How much is it?';
    const per = unitPer(unit);
    return per ? 'How much ' + per + '?' : 'How much is it?';
}

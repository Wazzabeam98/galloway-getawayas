// The house rules a host sets in the editor (edit-listing → House rules),
// turned into one view the trip card and the listing page both render, so a
// guest reads the same words before and after booking.
//
// Every listing has house rules by design. Sensible defaults apply even to a
// host who never opens the House rules screen: no events, no smoking, no
// commercial photography, and quiet hours 10pm–7am. These come from the column
// defaults (the three booleans default false = "no …"; quiet_hours_enabled
// defaults true — see the migration), so a guest sees them like any other rule,
// and the host can change any of them in the editor. Presented as the listing's
// house rules, not as law — no claim about council or nationwide noise rules.

import { formatTime } from './utils';

export interface HouseRulesInput {
    events_allowed?: boolean | null;
    smoking_allowed?: boolean | null;
    commercial_photography_allowed?: boolean | null;
    quiet_hours_enabled?: boolean | null;
    quiet_hours_start?: string | null;
    quiet_hours_end?: string | null;
    check_in_time?: string | null;
    check_in_end_time?: string | null;
    check_out_time?: string | null;
    additional_rules?: string | null;
}

// `allowed` drives the tick/cross; `neutral` marks an informational line (quiet
// hours) that is neither an allowance nor a ban.
export interface HouseRule { label: string; allowed: boolean; neutral?: boolean; }

export interface HouseRulesView {
    rules: HouseRule[];
    checkInFrom: string;
    checkInUntil: string | null;
    checkoutBy: string;
    additional: string | null;
}

const DEFAULT_IN = '15:00:00';
const DEFAULT_OUT = '11:00:00';

export function houseRulesView(l: HouseRulesInput | null | undefined): HouseRulesView {
    const x = l || {};
    const events = !!x.events_allowed;
    const smoking = !!x.smoking_allowed;
    const photo = !!x.commercial_photography_allowed;
    const quiet = !!x.quiet_hours_enabled;
    const additional = (x.additional_rules || '').trim() || null;
    const inFrom = x.check_in_time || DEFAULT_IN;
    const inUntil = x.check_in_end_time || null;
    const outBy = x.check_out_time || DEFAULT_OUT;

    const rules: HouseRule[] = [
        { label: events ? 'Events and parties allowed' : 'No events or parties', allowed: events },
        { label: smoking ? 'Smoking, vaping and e-cigarettes allowed' : 'No smoking, vaping or e-cigarettes', allowed: smoking },
        { label: photo ? 'Commercial photography and filming allowed' : 'No commercial photography or filming', allowed: photo },
    ];
    if (quiet) {
        rules.push({
            label: 'Quiet hours ' + formatTime(x.quiet_hours_start || '22:00') + ' – ' + formatTime(x.quiet_hours_end || '07:00'),
            allowed: false,
            neutral: true,
        });
    }

    return {
        rules,
        checkInFrom: formatTime(inFrom),
        checkInUntil: inUntil ? formatTime(inUntil) : null,
        checkoutBy: formatTime(outBy),
        additional,
    };
}

// The house rules a host sets in the editor (edit-listing → House rules),
// turned into one view the trip card and the listing page both render, so a
// guest reads the same words before and after booking.
//
// A wrinkle worth knowing: events/smoking/commercial-photography are
// NOT NULL DEFAULT false booleans (set by an X/✓ toggle), so the database has
// no "unset" for them — every listing technically says "no" to all three. To
// avoid papering a brand-new, untouched listing with a wall of default "No …"
// lines, `configured` treats the host as having engaged with House rules only
// when there's a real signal: an allowance granted, quiet hours on, additional
// text written, a check-in-until set, or a non-default check-in/checkout time.
// When `configured` is false the surfaces render nothing.

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
    configured: boolean;
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

    const nonDefaultTimes = inFrom !== DEFAULT_IN || outBy !== DEFAULT_OUT || !!inUntil;
    const configured = events || smoking || photo || quiet || !!additional || nonDefaultTimes;

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
        configured,
        rules,
        checkInFrom: formatTime(inFrom),
        checkInUntil: inUntil ? formatTime(inUntil) : null,
        checkoutBy: formatTime(outBy),
        additional,
    };
}

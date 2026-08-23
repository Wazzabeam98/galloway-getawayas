// The kinds of scheduled message a host can set up.
//
// One definition, imported by the editor and by the coverage grid. It lived in
// both, which is how "Checking in with guest" came to mean two different
// things in two places — and a label that drifts is a label nobody trusts.

export interface TemplateDef {
    key: string;
    label: string;
    hint: string;
    placeholder: string;
    defaultOffset: number;
    // Which kind of timing makes sense: hung off the booking being accepted,
    // or off the dates of the stay itself.
    family: 'booking' | 'stay' | 'settled' | 'checkout';
    offsetLabel?: string;
    offsetChoices?: number[];
}

export const TEMPLATE_TYPES: TemplateDef[] = [
    {
        key: 'booking_confirmation',
        family: 'booking',
        label: 'Booking confirmation',
        hint: 'Sent the moment you accept a booking request.',
        placeholder: "Thanks for booking {listing}! I've confirmed your stay from {check_in} to {check_out}. Any questions before you arrive, just reply here.",
        defaultOffset: 0,
    },
    {
        key: 'checkin_details',
        family: 'stay',
        label: 'Check-in details',
        hint: 'The practical stuff — address, key safe, parking, wifi.',
        // Uses {lockbox_code} rather than a made-up code on purpose. The
        // example is the first thing a host edits, and one showing a literal
        // code teaches exactly the habit the placeholder exists to replace —
        // one message per property, each with its own code typed in.
        placeholder: "You're arriving at {listing} on {check_in}. Check-in is any time after 3pm. The key is in the lockbox by the front door — the code is {lockbox_code}. Parking is on the street directly outside.",
        defaultOffset: 3,
        offsetLabel: 'days before arrival',
        offsetChoices: [1, 2, 3, 4, 5, 6, 7, 10, 14],
    },
    {
        key: 'checkin_day',
        family: 'settled',
        // Not "Checking in with guest". This fires an hour or so after they
        // arrive, and "checking in" reads as the note you get when you book —
        // which is a different template entirely, two rows up.
        label: 'Settling in',
        hint: 'A friendly note once they have arrived and had a chance to settle in.',
        placeholder: "Just checking you got in alright and everything's as you expected at {listing}. Any problems at all, give me a shout and I'll sort it.",
        defaultOffset: 0,
    },
    {
        key: 'checkout_details',
        family: 'checkout',
        label: 'Check-out details',
        hint: 'What you need them to do before they leave — counted back from your check-out time.',
        placeholder: "Hope you've had a lovely stay. Check-out is by 11am on {check_out} — just pop the keys back in the safe and close the door behind you. Bins are round the side if you have any rubbish.",
        defaultOffset: 1,
        offsetLabel: 'days before departure',
        offsetChoices: [1, 2, 3],
    },
];

export function templateDefFor(key: string): TemplateDef {
    return TEMPLATE_TYPES.filter((d) => d.key === key)[0] || TEMPLATE_TYPES[0];
}

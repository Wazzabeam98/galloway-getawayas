// Chargebacks: what Stripe is asking, and what we can actually send back.
//
// A dispute is won or lost on evidence, and the useful evidence differs
// sharply by reason. A holiday let is in an unusually strong position for most
// of them — there is a booking record, the guest's own messages, a calendar
// block nobody else could have used, and for most reasons the fact they turned
// up and stayed. None of that helps if nobody assembles it before the
// deadline, which is why this exists as a checklist rather than as prose
// somebody has to remember.
//
// Nothing here submits anything. Submitting evidence to Stripe is final and
// cannot be revised, so a half-assembled submission is worse than a late one.

export interface DisputeGuidance {
    // Plain English, for somebody who has just had an email at 7am.
    meaning: string;
    // What to gather, in the order it is worth gathering it.
    evidence: string[];
    // Where it already is in our own data.
    weHold: string[];
}

const CORE_RECORDS = [
    'The booking record — dates, guest name, what was paid and when',
    'The message thread with the guest',
    'The listing as it was advertised, including the cancellation policy they agreed to',
];

// Stripe's reason codes. Anything unrecognised falls through to the generic
// entry rather than guessing, because guessing wrong here loses money.
const GUIDANCE: Record<string, DisputeGuidance> = {
    product_not_received: {
        meaning: 'The guest says they did not get what they paid for — that the stay never happened.',
        evidence: [
            'Evidence the stay took place: messages during it, the key safe code being sent and used, any photos',
            'The check-in details message and when it was sent',
            'Confirmation the dates were held and nobody else could book them',
            'Anything from the host confirming the guest arrived',
        ],
        weHold: [
            'The scheduled check-in message and its send time',
            'The message thread across the stay itself',
            'The calendar block for those dates',
        ],
    },
    fraudulent: {
        meaning: 'The cardholder says they did not authorise this — usually a stolen card, sometimes a family member booking without telling them.',
        evidence: [
            'The IP address and device the booking was made from, if held',
            'The email address and any correspondence proving the cardholder knew about the stay',
            'Evidence the person who stayed is connected to the cardholder',
            'Whether the card passed 3-D Secure at the time',
        ],
        weHold: [
            'The guest account, its email, and when it was created',
            'The message thread, which often shows the cardholder engaging directly',
        ],
    },
    duplicate: {
        meaning: 'The guest says they were charged twice for the same thing.',
        evidence: [
            'Both charges side by side, showing what each was for',
            'If it was a deposit and a balance, the split and the dates each was taken',
            'The booking total, showing the two together come to the agreed price and no more',
        ],
        weHold: [
            'The payments record for the booking, with the deposit and balance separately',
            'The agreed total on the booking',
        ],
    },
    subscription_canceled: {
        meaning: 'The guest says they cancelled and should not have been charged.',
        evidence: [
            'The cancellation policy they agreed to at booking',
            'Whether a cancellation was ever requested, and when',
            'What the policy entitled them to at that point, and what was actually refunded',
        ],
        weHold: [
            'The stored free-cancellation date on the booking',
            'Any refund already issued, with its amount and date',
        ],
    },
    general: {
        meaning: 'The bank has not given a specific reason. Treat it as "prove the stay was booked, agreed and delivered".',
        evidence: [
            'Everything that shows the booking was made deliberately and the stay delivered',
            'The cancellation policy they agreed to',
        ],
        weHold: CORE_RECORDS,
    },
};

export function guidanceFor(reason: string | null | undefined): DisputeGuidance {
    const key = String(reason || 'general');
    const found = GUIDANCE[key];
    if (found) {
        return { meaning: found.meaning, evidence: found.evidence, weHold: found.weHold.concat(CORE_RECORDS) };
    }
    return {
        meaning: 'Stripe gave the reason as "' + key + '", which we have no specific guidance for. '
            + 'Read Stripe’s own note on the dispute before assembling anything.',
        evidence: GUIDANCE.general.evidence,
        weHold: CORE_RECORDS,
    };
}

// How long is left, in words somebody can act on. Negative means it has gone.
export function deadlineText(dueBy: Date | null, now: Date): string {
    if (!dueBy) return 'Stripe has not given a deadline for this one — check in Stripe directly.';

    const hours = Math.floor((dueBy.getTime() - now.getTime()) / 3600000);

    if (hours < 0) return 'The deadline has passed.';
    if (hours < 24) return hours + (hours === 1 ? ' hour left' : ' hours left');

    const days = Math.floor(hours / 24);
    return days + (days === 1 ? ' day left' : ' days left');
}

// Worth waking somebody up for. Stripe's windows are short and a missed one is
// a dispute lost by default rather than on the facts.
export function isUrgent(dueBy: Date | null, now: Date): boolean {
    if (!dueBy) return true;
    return dueBy.getTime() - now.getTime() < 72 * 3600000;
}

// An early fraud warning is not a chargeback.
//
// Stripe's `warning_*` statuses are an inquiry: the card network has flagged
// the charge, and no money has been taken. It still wants answering — a good
// response can stop it becoming a real dispute — but it is not a liability,
// and adding it to the amount at risk overstates what is actually gone.
//
// Found by raising both against test Stripe and watching the page total two
// different kinds of thing together. A warning cannot even be closed the way
// a dispute can, which is the tell.
export function isInquiry(status: string | null | undefined): boolean {
    return String(status || '').indexOf('warning') === 0;
}

// Money actually withdrawn and not yet returned. Won disputes, reinstated
// funds and inquiries are all excluded — a total nobody can explain becomes a
// total nobody trusts.
export function isMoneyAtRisk(dispute: { status: string | null; funds_reinstated_at: string | null }): boolean {
    if (dispute.funds_reinstated_at) return false;
    const status = String(dispute.status || '');
    if (isInquiry(status)) return false;
    return status !== 'won';
}

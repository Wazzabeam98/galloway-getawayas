// What an enquiry is, what state it can be in, and what each side is told.
//
// Same shape as lib/serviceProviders.ts and lib/listingRules.ts: pure
// functions and constants, no queries, so the shop, the enquiry form, the
// reply route and the expiry sweep all read the same rules and can be tested
// without a database anywhere near it.
//
// THERE IS NO MONEY IN HERE, AND THAT IS THE POINT
//
// Every trade that reaches this flow is on the subscription. The platform
// takes nothing per job, the work is paid off-platform, and so there is no
// total, no commission, no charge at acceptance and no refund. What the
// platform sells is the introduction. If a trade that pays commission is ever
// pointed at this file, the missing total is not a gap to fill in here — it
// means that trade wants a booking instead.

import {
    capabilityFor,
    extraByKey,
    calloutLine,
    pricingModelFor,
    canBeEnquiredAbout,
} from '@/lib/serviceProviders';

// ---------------------------------------------------------------------------
// STATES
// ---------------------------------------------------------------------------
//
//                        ┌─ accepted   contact details released both ways
//   sent ──▶ viewed ─────┼─ declined   with a reason, if he gave one
//     │        │         └─ (silence)
//     │        │              │
//     │        └──────────────┴──▶ expired    the sweep, at expires_at
//     └───────────────────────────▶ withdrawn  host pulled it first
//
//   direct                        emergency: the number was shown, the row is
//                                 the record of it. Never waits for anything.
//
// `viewed` earns its place because it is the only thing separating "ignored"
// from "never seen", and those need different words on the host's screen and
// different conversations at renewal.
//
// There is deliberately no 'completed'. Nothing on the platform can observe a
// job being done — see `outcome` on the table.

export const ENQUIRY_STATUSES = [
    'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'direct',
] as const;

export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

// Still waiting on the tradesman. The only two states the expiry sweep touches
// and the only two the one-open-enquiry index counts.
export const OPEN_STATUSES: EnquiryStatus[] = ['sent', 'viewed'];

export function isOpen(status: string): boolean {
    return (OPEN_STATUSES as string[]).indexOf(String(status || '')) !== -1;
}

// Whether the two sides now have each other's details.
//
// One function, because three screens and two emails ask this question and
// three answers is how they come to disagree about whether a phone number is
// on the page.
export function contactReleased(status: string): boolean {
    const s = String(status || '');
    return s === 'accepted' || s === 'direct';
}

export function canWithdraw(status: string): boolean {
    return isOpen(status);
}

// A reply link is spent once the enquiry has stopped waiting. An expired one
// included: a tradesman answering on the fourth day is answering a question
// the host has already taken elsewhere, and telling him it went through would
// be a lie that costs him a wasted journey.
export function canRespond(status: string): boolean {
    return isOpen(status);
}

// ---------------------------------------------------------------------------
// URGENCY
// ---------------------------------------------------------------------------
//
// EMERGENCY IS NOT AN ENQUIRY
//
// A burst pipe at nine at night is not solved by a web form and a countdown.
// So emergency does not send anything and does not wait for anybody: the host
// is shown the tradesman's number and rings it, and the row is written
// afterwards as the record that it happened. The introduction is the product,
// and for an emergency it should simply happen.
//
// The consequence, stated rather than hidden: an emergency releases a
// tradesman's phone number without him agreeing to that particular job. He
// agreed to it by ticking that he turns out — see `offersEmergency` below,
// which is why a provider who has not ticked it is never offered.

export const URGENCY_LEVELS = [
    {
        key: 'emergency',
        label: 'Emergency — something is happening now',
        hint: 'A leak, no power, no heat, a guest locked out. You get the number and ring it.',
        hours: 0,
    },
    {
        key: 'soon',
        label: 'Soon — in the next few days',
        hint: 'Broken, but nothing is being damaged while it waits.',
        hours: 48,
    },
    {
        key: 'planned',
        label: 'Planned work',
        hint: 'A job to book in. Quotes, improvements, seasonal work.',
        hours: 120,
    },
] as const;

export type Urgency = (typeof URGENCY_LEVELS)[number]['key'];

export function isUrgency(value: string): boolean {
    return URGENCY_LEVELS.some((u) => u.key === String(value || ''));
}

export function urgencyLabel(key: string): string {
    const found = URGENCY_LEVELS.filter((u) => u.key === key)[0];
    return found ? found.label : '';
}

export function isEmergency(urgency: string): boolean {
    return String(urgency || '') === 'emergency';
}

// When the tradesman stops being asked.
//
// Null for an emergency, and that is enforced by a check constraint on the
// table as well: a row that waits for ever is the failure this whole idea is
// most likely to produce, so it is stated twice.
//
// 48 hours for 'soon' is the number the site already promises elsewhere —
// REVIEW_WITHIN_HOURS — so it is the familiar one rather than a new invention.
export function expiresAt(urgency: string, sentAt: Date | string): string | null {
    if (isEmergency(urgency)) return null;

    const found = URGENCY_LEVELS.filter((u) => u.key === String(urgency || ''))[0];
    const hours = found ? found.hours : 48;

    const base = typeof sentAt === 'string' ? new Date(sentAt) : sentAt;
    return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function hasExpired(row: { status?: string; expires_at?: string | null }, now?: Date): boolean {
    if (!row || !isOpen(String(row.status || ''))) return false;
    if (!row.expires_at) return false;
    return new Date(row.expires_at).getTime() <= (now || new Date()).getTime();
}

// ---------------------------------------------------------------------------
// WHO CAN BE ASKED
// ---------------------------------------------------------------------------

// Whether this provider can be handed to a host mid-emergency.
//
// A number to ring is the entire mechanism, so a provider without one cannot
// be offered however willing he is. The tick is his own: `*_out_of_hours` and
// `*_same_day` are availability toggles he set at sign-up, and being shown to
// a host at nine at night is what they mean.
export function offersEmergency(
    provider: any,
    offered: string[] | null | undefined
): boolean {
    if (!provider) return false;
    if (!String(provider.contact_phone || '').trim()) return false;

    const keys = (offered || []).map((k) => String(k));
    return keys.some((k) => k.indexOf('_out_of_hours') !== -1 || k.indexOf('_same_day') !== -1);
}

// The fault list a host ticks from — the same entries the tradesman ticked
// when he signed up, so "something keeps tripping" means one thing to both of
// them and the email needs no translation.
export function faultOptions(trade: string): Array<{ key: string; label: string }> {
    return capabilityFor(trade)
        .filter((e) => e.group === 'faults')
        .map((e) => ({ key: e.key, label: e.label }));
}

// What a host ticked, said in words, for the email and the screens.
export function faultLabels(keys: string[] | null | undefined): string[] {
    return (keys || [])
        .map((k) => extraByKey(String(k)))
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((e) => e.label);
}

// ---------------------------------------------------------------------------
// THE PRICE SNAPSHOT
// ---------------------------------------------------------------------------
//
// What the host was looking at when they pressed the button. Stored rather
// than joined, because a provider who puts his call-out up on Thursday must
// not retrospectively have quoted it on Tuesday.
//
// It is a display record and nothing multiplies it. There is no total to
// compute: the job is paid off-platform.

export interface PriceSnapshot {
    model?: string;
    callout_fee?: number | null;
    hourly_rate?: number | null;
    callout_waived?: boolean;
    band_key?: string | null;
    band_price?: number | null;
}

function num(value: any): number | null {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (raw === '') return null;
    const n = Number(raw);
    return isFinite(n) && n > 0 ? n : null;
}

export function priceSnapshot(
    provider: any,
    bandKey?: string | null,
    bandPrice?: any
): PriceSnapshot {
    const trade = String((provider && provider.trade) || '');

    return {
        model: pricingModelFor(trade),
        callout_fee: num(provider && provider.callout_fee),
        hourly_rate: num(provider && provider.hourly_rate),
        callout_waived: !!(provider && provider.callout_waived),
        band_key: bandKey ? String(bandKey) : null,
        band_price: num(bandPrice),
    };
}

// The snapshot as a line a person reads. Null when the provider published
// nothing, which is an honest state for a roofer and must not render as "£0".
export function snapshotLine(snapshot: PriceSnapshot | null | undefined): string | null {
    if (!snapshot) return null;

    const parts: string[] = [];

    if (snapshot.band_price) {
        parts.push('£' + fmt(snapshot.band_price) + ' per visit');
    }

    const callout = calloutLine(snapshot.callout_fee ?? null, snapshot.callout_waived);
    if (callout) parts.push(callout);

    if (snapshot.hourly_rate) parts.push('£' + fmt(snapshot.hourly_rate) + ' an hour');

    return parts.length ? parts.join(' · ') : null;
}

function fmt(amount: number): string {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

// ---------------------------------------------------------------------------
// THE REFERENCE
// ---------------------------------------------------------------------------
//
// Quotable on the phone. A tradesman ringing about "GG-7K2M" can start a
// conversation; one ringing about a uuid cannot.
//
// No I, O, 0 or 1 — this gets read aloud and written on the back of a hand.
// The random source is a parameter so a test can pin it, rather than the
// function reaching for Math.random and being untestable.
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function enquiryReference(random?: () => number): string {
    const rnd = random || Math.random;
    let out = '';
    for (let i = 0; i < 4; i++) {
        out += REFERENCE_ALPHABET.charAt(Math.floor(rnd() * REFERENCE_ALPHABET.length));
    }
    return 'GG-' + out;
}

// ---------------------------------------------------------------------------
// WHAT HAS TO BE FILLED IN
// ---------------------------------------------------------------------------

export interface Problem {
    field: string;
    message: string;
}

export interface EnquiryDraft {
    trade?: string | null;
    provider_id?: string | null;
    listing_id?: string | null;
    urgency?: string | null;
    summary?: string | null;
    fault_keys?: string[] | null;
    host_phone?: string | null;
    host_name?: string | null;
}

// Short enough that a tradesman can read it on a phone, long enough to be
// worth reading. Ticked faults are not a substitute: "no hot water" and "no
// hot water since the tank was drained on Sunday" are different call-outs.
export const MIN_SUMMARY = 15;

export function enquiryProblems(draft: EnquiryDraft): Problem[] {
    const problems: Problem[] = [];
    const trade = String(draft.trade || '');

    if (!trade) {
        problems.push({ field: 'trade', message: 'Pick a trade.' });
    } else if (!canBeEnquiredAbout(trade)) {
        problems.push({ field: 'trade', message: 'That trade cannot be enquired about yet.' });
    }

    if (!String(draft.provider_id || '').trim()) {
        problems.push({ field: 'provider_id', message: 'Pick who to ask.' });
    }

    if (!isUrgency(String(draft.urgency || ''))) {
        problems.push({ field: 'urgency', message: 'Say how urgent it is.' });
    }

    const summary = String(draft.summary || '').trim();
    if (summary.length < MIN_SUMMARY) {
        problems.push({
            field: 'summary',
            message: 'Say what is wrong, in a sentence or two.',
        });
    }

    // A number, not an address. He is going to ring before he drives.
    if (!String(draft.host_phone || '').trim()) {
        problems.push({ field: 'host_phone', message: 'A phone number he can ring you on.' });
    }

    if (!String(draft.host_name || '').trim()) {
        problems.push({ field: 'host_name', message: 'Your name.' });
    }

    return problems;
}

export function canSend(draft: EnquiryDraft): boolean {
    return enquiryProblems(draft).length === 0;
}

// ---------------------------------------------------------------------------
// WHAT THE HOST IS TOLD
// ---------------------------------------------------------------------------
//
// The words a person reads, kept next to the values they come from so the two
// cannot drift — same as statusSummary in lib/serviceProviders.ts.
//
// Note what 'sent' and 'viewed' do NOT say. Neither promises anybody is
// coming. With one tradesman and no fan-out, silence is the likeliest way this
// fails, and a screen that says "on their way" while nothing has happened is
// how a host finds that out at the worst possible moment.

export function hostStatusSummary(
    status: string,
    businessName?: string | null
): { label: string; detail: string } {
    const who = String(businessName || 'They').trim() || 'They';

    if (status === 'sent') {
        return {
            label: 'Sent',
            detail: who + ' has been emailed. Nobody has opened it yet.',
        };
    }
    if (status === 'viewed') {
        return {
            label: 'Opened',
            detail: who + ' has read it and not answered yet.',
        };
    }
    if (status === 'accepted') {
        return {
            label: 'Accepted',
            detail: who + ' will take a look. Their number is below — arrange it between you.',
        };
    }
    if (status === 'declined') {
        return {
            label: 'Not this one',
            detail: who + ' cannot take it on. Try somebody else who covers you.',
        };
    }
    if (status === 'expired') {
        return {
            label: 'No answer',
            detail: 'Nobody replied in time. Try somebody else who covers you.',
        };
    }
    if (status === 'withdrawn') {
        return { label: 'Withdrawn', detail: 'You took this back. Nothing was sent on.' };
    }
    if (status === 'direct') {
        return {
            label: 'Number given',
            detail: 'You were given ' + who + "'s number for an emergency. We told them to expect you.",
        };
    }

    return { label: 'Enquiry', detail: '' };
}

// How it went, asked afterwards and believed only as far as it deserves.
//
// Self-reported by whichever side answers, gating nothing and billed on
// nothing. That is exactly why it is safe to ask for: the day a number here
// decides what somebody pays, it stops being good enough.
export const OUTCOMES = [
    { key: 'went_ahead', label: 'They did the work' },
    { key: 'did_not', label: 'It did not go ahead' },
    { key: 'no_contact', label: 'We never actually spoke' },
] as const;

export function isOutcome(value: string): boolean {
    return OUTCOMES.some((o) => o.key === String(value || ''));
}

export function outcomeLabel(key: string): string {
    const found = OUTCOMES.filter((o) => o.key === key)[0];
    return found ? found.label : '';
}

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
//     │        └──────────────┴──▶ expired    the sweep, ordinary work
//     │                        └──▶ released  the sweep, an emergency
//     └───────────────────────────▶ withdrawn  host pulled it first
//
// `viewed` earns its place because it is the only thing separating "ignored"
// from "never seen", and those need different words on the host's screen and
// different conversations at renewal.
//
// `released` and `expired` are the same event with opposite endings, and the
// difference is the whole of the emergency design — see URGENCY below. Silence
// on ordinary work means "try somebody else". Silence on an emergency means
// "here is his number, ring him", because a burst pipe cannot be asked to wait
// for a better process.
//
// There is deliberately no 'completed'. Nothing on the platform can observe a
// job being done — see `outcome` on the table.

export const ENQUIRY_STATUSES = [
    'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'released',
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
    return s === 'accepted' || s === 'released';
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
// AN EMERGENCY IS STILL AN ENQUIRY, AND THAT IS A REVERSAL
//
// It was built handing the host the number on the spot. That was wrong, and
// the reason is not about the host at all — it is about what the platform can
// prove. Every trade in this flow is free for ninety days and then twenty
// pounds a month, and the only argument for the twenty pounds is "you got five
// jobs out of us". An introduction nobody accepted is not evidence of
// anything. Hand the number over unasked and the accept never happens, and the
// record of the work quietly stops existing.
//
// So an emergency is sent, and waits — but it waits for MINUTES, not days, and
// silence releases the number instead of giving up on it. The host is never
// left holding nothing: worst case they wait EMERGENCY_MINUTES and then get
// exactly what they would have got immediately.
//
// WHY TWENTY MINUTES
//
// Short enough that a host with water coming through a ceiling is not sitting
// still — that is the whole constraint on one side.
//
// Long enough, on the other, that the accept is a real event. A tradesman
// glances at his phone between jobs; five minutes would auto-release nearly
// every emergency, which destroys the evidence this change exists to create
// and would be the old behaviour wearing a delay. Twenty is the point where a
// phone notification has plausibly been seen and answered.
//
// It is a constant rather than a number in three places because it is going to
// be argued with once there are real ones to count, and the thing to look at
// then is the ratio of accepted to released.
// ---------------------------------------------------------------------------

export const EMERGENCY_MINUTES = 20;

export const URGENCY_LEVELS = [
    {
        key: 'emergency',
        label: 'Emergency — something is happening now',
        hint: 'A leak, no power, no heat, a guest locked out. If nobody answers within '
            + EMERGENCY_MINUTES + ' minutes we give you their number to ring.',
        minutes: EMERGENCY_MINUTES,
    },
    {
        key: 'soon',
        label: 'Soon — in the next few days',
        hint: 'Broken, but nothing is being damaged while it waits.',
        minutes: 48 * 60,
    },
    {
        key: 'planned',
        label: 'Planned work',
        hint: 'A job to book in. Quotes, improvements, seasonal work.',
        minutes: 120 * 60,
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

// What silence means for this enquiry.
//
// One function rather than `urgency === 'emergency'` scattered through the
// sweep, the emails and two screens. The sweep in particular has to decide
// between two opposite endings on the same query, and a stray comparison there
// would either strand a host in an emergency or hand out a number after an
// ordinary job went quiet.
export function releasesOnSilence(urgency: string): boolean {
    return isEmergency(urgency);
}

// When the tradesman stops being asked.
//
// Never null now — an emergency has the shortest deadline rather than none at
// all, which is the reversal in one line. The database says the same thing:
// see the expiry check constraint.
export function expiresAt(urgency: string, sentAt: Date | string): string {
    const found = URGENCY_LEVELS.filter((u) => u.key === String(urgency || ''))[0];
    const minutes = found ? found.minutes : 48 * 60;

    const base = typeof sentAt === 'string' ? new Date(sentAt) : sentAt;
    return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

// What the sweep should do with a row whose time is up.
//
// Returns null for anything not due, so the caller has one question to ask
// rather than three, and the emergency/ordinary split lives here rather than
// being re-derived at every call site.
export function dueOutcome(
    row: { status?: string; urgency?: string; expires_at?: string | null },
    now?: Date
): 'released' | 'expired' | null {
    if (!hasExpired(row, now)) return null;
    return releasesOnSilence(String(row.urgency || '')) ? 'released' : 'expired';
}

export function hasExpired(row: { status?: string; expires_at?: string | null }, now?: Date): boolean {
    if (!row || !isOpen(String(row.status || ''))) return false;
    if (!row.expires_at) return false;
    return new Date(row.expires_at).getTime() <= (now || new Date()).getTime();
}

// ---------------------------------------------------------------------------
// WHEN THE HOST WANTS SOMEBODY
// ---------------------------------------------------------------------------
//
// Planned work has a date and a window on it, because that is how a host
// actually thinks: somebody on the 3rd, between eleven and three, in the gap
// between one guest leaving and the next arriving. Asking for that as free
// text produces "sometime the week after next if that's ok?" and a phone call
// to pin down what a date field would have said.
//
// IT IS A REQUEST, AND EVERY WORD HAS TO SAY SO
//
// There is NO capacity model here. Nothing knows whether he is free on the
// 3rd, nothing holds the slot, and nothing stops the same window being asked
// for by four hosts. So this must never render as a booking:
//
//   * `requestedWhen` always begins "Asked for". Not "Booked for", not
//     "Confirmed", not a bare date sitting under a heading that could be read
//     as either.
//   * No calendar with days marked free or busy. A date input and two times.
//     A calendar is a promise about availability and there is nothing behind
//     it.
//   * The tradesman's email says what they ASKED for, and his accept means "I
//     will take a look", not "I am there at eleven on the 3rd". The two of
//     them settle the actual time between themselves, which is what happens
//     anyway.
//
// If a capacity model is ever built, this comment is the list of things that
// were deliberately not done, rather than things nobody thought of.

export const TIME_WINDOWS = [
    { key: 'any', label: 'Any time that day', from: null, to: null },
    { key: 'morning', label: 'Morning — 8am to 12', from: '08:00', to: '12:00' },
    { key: 'changeover', label: 'Changeover — 11am to 3pm', from: '11:00', to: '15:00' },
    { key: 'afternoon', label: 'Afternoon — 12 to 5pm', from: '12:00', to: '17:00' },
] as const;

export function windowByKey(key: string) {
    return TIME_WINDOWS.filter((w) => w.key === String(key || ''))[0] || null;
}

// Which urgencies carry a date. Only planned work: an emergency is happening
// now by definition, and "soon" is the answer of somebody who does not have a
// date in mind and should not be made to invent one.
export function needsDate(urgency: string): boolean {
    return String(urgency || '') === 'planned';
}

function prettyTime(value: string | null | undefined): string {
    const raw = String(value || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(raw)) return '';

    const hour = Number(raw.slice(0, 2));
    const minute = raw.slice(3, 5);
    const suffix = hour < 12 ? 'am' : 'pm';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;

    return minute === '00' ? twelve + suffix : twelve + '.' + minute + suffix;
}

// What the host asked for, in words, ALWAYS as a request.
//
// Returns null when there is nothing to say, so a caller renders no line
// rather than an empty one — "Asked for" with nothing after it reads like
// something failed to load.
export function requestedWhen(row: {
    preferred_date?: string | null;
    window_from?: string | null;
    window_to?: string | null;
}): string | null {
    if (!row || !row.preferred_date) return null;

    const date = new Date(String(row.preferred_date) + 'T12:00:00Z');
    if (isNaN(date.getTime())) return null;

    const when = date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/London',
    });

    const from = prettyTime(row.window_from);
    const to = prettyTime(row.window_to);

    // "Asked for", every time. See the note above: this string ends up in an
    // email, on the host's list and on the tradesman's reply page, and it is
    // the only thing standing between a request and something that reads like
    // an appointment he agreed to.
    if (from && to) return 'Asked for ' + when + ', between ' + from + ' and ' + to;
    return 'Asked for ' + when + ', any time that day';
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
    preferred_date?: string | null;
    window_from?: string | null;
    window_to?: string | null;
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

    // Planned work carries a date. Not the other two: an emergency is
    // happening now, and somebody who picked "soon" is telling us they have no
    // date in mind — making them invent one produces a date nobody meant.
    if (needsDate(String(draft.urgency || ''))) {
        const date = String(draft.preferred_date || '').trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00Z').getTime())) {
            problems.push({ field: 'preferred_date', message: 'Which day would you like them?' });
        }
    }

    // A window is optional — "any time that day" is a real answer and the
    // default. What is not allowed is a backwards one, which is a typo rather
    // than a preference and would be quoted back at the tradesman as nonsense.
    const from = String(draft.window_from || '').trim();
    const to = String(draft.window_to || '').trim();

    if (from && to && to <= from) {
        problems.push({ field: 'window_to', message: 'The window has to end after it starts.' });
    }
    if ((from && !to) || (to && !from)) {
        problems.push({ field: 'window_to', message: 'Give both ends of the window, or neither.' });
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
    businessName?: string | null,
    row?: { urgency?: string | null; expires_at?: string | null } | null
): { label: string; detail: string } {
    const who = String(businessName || 'They').trim() || 'They';

    // An emergency still waiting says WHEN it stops waiting, because that is
    // the promise being made and a host watching water come through a ceiling
    // is entitled to know how long they are watching for. "Nobody has opened
    // it yet" on its own would read as being left to it.
    const emergencyWait = row
        && isEmergency(String(row.urgency || ''))
        && isOpen(status);

    if (emergencyWait) {
        return {
            label: status === 'viewed' ? 'Opened' : 'Sent',
            detail: (status === 'viewed'
                ? who + ' has opened it. '
                : who + ' has been emailed. ')
                + 'If they have not answered by ' + clockTime(row!.expires_at)
                + ' we will give you their number to ring.',
        };
    }

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
    if (status === 'released') {
        return {
            label: 'Number released',
            detail: who + ' did not answer in time, so here is their number — ring them. '
                + 'We have told them to expect you.',
        };
    }

    return { label: 'Enquiry', detail: '' };
}

// A wall-clock time in the one time zone this site cares about. Vercel runs in
// UTC, which in summer is an hour behind Dumfries — enough to promise a host a
// number at half past two when it is half past three outside.
export function clockTime(value: string | null | undefined): string {
    if (!value) return 'shortly';

    const when = new Date(String(value));
    if (isNaN(when.getTime())) return 'shortly';

    return when.toLocaleTimeString('en-GB', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Europe/London',
    });
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

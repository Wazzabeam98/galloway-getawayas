// Choosing which "finish your listing" reminders are due, kept as pure
// functions so the timing can be tested without a database or a clock.
//
// A host who starts the add-a-listing wizard and leaves it in draft gets at
// most two emails: one at about 48 hours, a second at about seven days. Each
// kind is sent once — the host_draft_reminders row is the claim — and neither
// is ever sent once the listing leaves draft (the cron only ever looks at
// drafts). An old draft that is already past seven days gets the second
// straight away and claims the first alongside it, so it never arrives late.

export type DraftReminderKind = 'first' | 'second';

// When each reminder is due, measured from when the draft was created. There is
// no updated_at on listings, so "left" is "started and not finished" — which,
// for a wizard people abandon in one sitting, is the same thing in practice.
export const FIRST_REMINDER_HOURS = 48;
export const SECOND_REMINDER_DAYS = 7;

export interface ReminderDraft {
    id: string;
    created_at: string; // ISO
}

export interface PlannedDraftReminder {
    listingId: string;
    kind: DraftReminderKind;
    // Claimed alongside the one sent, without its own email — so a draft that is
    // already older than the second window never also gets a late first.
    alsoClaim?: DraftReminderKind;
}

/**
 * Which reminders are due now.
 *
 * `claimed` is the set of `${listingId}:${kind}` already emailed. `nowMs` is the
 * current time in ms. Each draft yields at most one plan: the second once it is
 * past seven days (claiming the first with it), otherwise the first once it is
 * past forty-eight hours.
 */
export function planDraftReminders(
    drafts: ReminderDraft[],
    claimed: Set<string>,
    nowMs: number,
): PlannedDraftReminder[] {
    const out: PlannedDraftReminder[] = [];
    for (const d of drafts) {
        const ageMs = nowMs - Date.parse(d.created_at);
        if (!isFinite(ageMs) || ageMs < 0) continue;
        const ageHours = ageMs / 3600000;
        const ageDays = ageHours / 24;
        const has = (k: DraftReminderKind) => claimed.has(d.id + ':' + k);

        if (ageDays >= SECOND_REMINDER_DAYS && !has('second')) {
            // Past the second window. Send the second; also claim the first if
            // it never went, so it can't arrive afterwards.
            const entry: PlannedDraftReminder = { listingId: d.id, kind: 'second' };
            if (!has('first')) entry.alsoClaim = 'first';
            out.push(entry);
        } else if (ageHours >= FIRST_REMINDER_HOURS && !has('first')) {
            out.push({ listingId: d.id, kind: 'first' });
        }
    }
    return out;
}

/**
 * The email, by kind. `placeTitle` is the listing's title, or a gentle
 * fallback for a draft that never got one.
 */
export function draftReminderCopy(
    kind: DraftReminderKind,
    placeTitle: string | null | undefined,
): { subject: string; paragraphs: string[] } {
    const place = (placeTitle && placeTitle.trim()) ? placeTitle.trim() : 'your holiday let';
    if (kind === 'first') {
        return {
            subject: 'Your listing is almost ready — pick up where you left off',
            paragraphs: [
                `You started listing ${place} on Galloway Getaways and it’s saved as a draft — nothing’s lost.`,
                'Pick up exactly where you left off, add anything that’s missing, and it comes to us for a quick check before it goes live.',
                'It’s free to list, and you only pay 10% when you get a booking.',
            ],
        };
    }
    return {
        subject: `Still keen to list ${place}? You’re nearly there`,
        paragraphs: [
            `${place} is still saved as a draft on Galloway Getaways, a step or two from being live.`,
            'If you’d like a hand finishing it — a price, a few more photos, anything at all — just reply to this email and we’ll help. Otherwise, pick up where you left off whenever suits.',
            'It’s free to list, and you only pay 10% when you get a booking.',
        ],
    };
}

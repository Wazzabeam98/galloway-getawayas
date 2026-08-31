// The six emails that are the only reason anybody ever pays.
//
// Nobody has a card on file until the end of the ninety days, so this ladder
// is not a courtesy — it is the mechanism. If these do not go out, the
// subscription does not exist.
//
// The shape: one email that asks for nothing before any email that asks for
// something, and nothing at all after the card is in. A tradesman who has had
// ninety free days and then gets a bill out of nowhere is a tradesman who
// leaves; a tradesman chased for something he has already done is a tradesman
// who stops reading. Both failures are avoided by the same two rules and both
// live in lib/serviceSubscription.ts, not here.
//
// The wording never invents a date. Every date shown is `trial_ends_at` off
// the row — the same column the ladder counts back from and the same one the
// billing page prints — so an email and a page cannot disagree about the day
// he is going to be charged.

import {
    sendEmail,
    emailLayout,
    escapeHtml,
    button,
    detailRows,
    SITE_URL,
} from '@/lib/email';
import { isAutomatedTestAddress } from '@/lib/testAddresses';
import { logError } from '@/lib/logError';
import { SUBSCRIPTION_MONTHLY, TRIAL_DAYS } from '@/lib/serviceProviders';
import { GRACE_DAYS, Reminder } from '@/lib/serviceSubscription';

const FOOT = 'You are receiving this because you list a business on Galloway Getaways.';

function longDate(value: any): string {
    if (!value) return '';
    return new Date(String(value)).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
}

function p(text: string): string {
    return '<p style="margin:0 0 16px;font-size:16px;">' + text + '</p>';
}

// What the money is, said the same way every time.
function terms(): string {
    return detailRows([
        { label: 'What it costs', value: '£' + SUBSCRIPTION_MONTHLY + ' a month' },
        { label: 'Commission on your work', value: 'None — you quote and get paid direct' },
    ]);
}

export function reminderBody(reminder: Reminder, provider: any, link: string | null): string {
    const name = escapeHtml(String(provider.business_name || 'your business'));
    const ends = longDate(provider.trial_ends_at);
    const cta = link ? button(link, 'Add a card') : '';

    if (reminder.key === 'trial_started') {
        return emailLayout(
            p('Somebody has asked for <strong>' + name + '</strong> through Galloway Getaways, '
                + 'so your free period has started today.')
            + p('You have <strong>' + TRIAL_DAYS + ' free days</strong>, running to <strong>'
                + escapeHtml(ends) + '</strong>. There is nothing to pay and nothing to set up '
                + 'until then — we will write to you well before anything is due.')
            + terms()
            + p('It starts now rather than when you were approved because what you are paying '
                + 'for is the work we send you, and this is the first of it.'),
            FOOT
        );
    }

    if (reminder.key === 'thirty_days') {
        return emailLayout(
            p('A month left of your free listing for <strong>' + name + '</strong>. It runs to '
                + '<strong>' + escapeHtml(ends) + '</strong>.')
            + p('Nothing to do today — this is just so the date is not a surprise. We will ask you '
                + 'for a card a fortnight before it ends.')
            + terms(),
            FOOT
        );
    }

    if (reminder.key === 'fourteen_days') {
        return emailLayout(
            p('Your free period for <strong>' + name + '</strong> ends on <strong>'
                + escapeHtml(ends) + '</strong> — a fortnight from now.')
            + p('To stay listed, add a card. <strong>Nothing is taken before ' + escapeHtml(ends)
                + '</strong>, so you keep every remaining day of your free period by doing it now '
                + 'rather than later.')
            + terms()
            + cta,
            FOOT
        );
    }

    if (reminder.key === 'seven_days') {
        return emailLayout(
            p('A week left of the free period for <strong>' + name + '</strong>, which ends on '
                + '<strong>' + escapeHtml(ends) + '</strong>.')
            + p('Nothing is taken before then. If you would rather not carry on, ignore this and '
                + 'the listing will come down on its own — there is nothing to cancel.')
            + cta,
            FOOT
        );
    }

    if (reminder.key === 'one_day') {
        return emailLayout(
            p('The free period for <strong>' + name + '</strong> ends <strong>tomorrow</strong>, on '
                + escapeHtml(ends) + '.')
            + p('If a card is not added, your listing stays up for another ' + GRACE_DAYS
                + ' days and then comes off the site. Nothing else happens, and nothing is charged.')
            + cta,
            FOOT
        );
    }

    // grace
    return emailLayout(
        p('Your free period for <strong>' + name + '</strong> ended on <strong>'
            + escapeHtml(ends) + '</strong> and we have not been able to take a payment because '
            + 'there is no card on file.')
        + p('Your listing is still up. It comes down <strong>' + GRACE_DAYS + ' days after '
            + escapeHtml(ends) + '</strong> unless a card is added — and if it does come down, '
            + 'nothing is lost: adding a card afterwards puts it straight back, with the same '
            + 'details and no second review.')
        + terms()
        + cta,
        FOOT
    );
}

// Sends one reminder. Returns whether it went.
//
// Returns false rather than throwing on the ordinary failure paths, matching
// sendEmail — the caller has to read it, because an unsent "time to add a
// card" is the one failure that silently costs money.
export async function sendReminder(
    reminder: Reminder,
    provider: any,
    link: string | null
): Promise<boolean> {
    const to = String((provider && provider.contact_email) || '');
    if (!to) return false;

    // A test run must not ring a real tradesman's bell.
    if (isAutomatedTestAddress(to)) return false;

    // An email that asks for a card and carries no link is worse than no email:
    // he reads it, means to act, finds nothing to press, and concludes we are
    // shambolic. Refuse to send it and say so loudly instead.
    if (reminder.asks && !link) {
        await logError('service-subscription-no-link', {
            provider: String(provider.id),
            reminder: reminder.key,
            error: 'BILLING_TOKEN_SECRET is not set, so the card link could not be built',
        });
        return false;
    }

    return sendEmail(to, reminder.subject + ' — ' + String(provider.business_name || ''),
        reminderBody(reminder, provider, link));
}

export function billingLink(token: string | null): string | null {
    return token ? SITE_URL + '/services/billing/' + token : null;
}

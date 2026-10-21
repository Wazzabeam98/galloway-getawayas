// The emails for events recorded by database triggers rather than sent by the
// code that caused them (20261019174205): a chargeback against a host's booking,
// a guest declining a money request, an experience request or date change that
// ran out of time, and an account deactivated or suspended.
//
// Run by the push job (/api/cron/push-outbox) for a claimed 'notify.*' row, so
// each is sent exactly once and never from payment, payout or settlement code.
// Each email goes through sendEmail, which records its push through the shared
// layer (lib/pushRules has a rule per subject below), so email and push always
// go together. Read-only on the tables involved.

import { sendEmail, emailLayout, escapeHtml, button, SITE_URL, NEUTRAL_SUBTITLE } from './email';
import { formatGBP } from './formatMoney';
import { ukDate } from './dayKey';
import type { RowOutcome } from './pushDispatch';

const H = (t: string) => '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + t + '</h1>';
const P = (t: string) => '<p style="margin:0 0 16px 0;">' + t + '</p>';

const HOST_FOOT = 'You’re receiving this because you host on Galloway Getaways.';
const ORDER_FOOT = 'You’re receiving this because you have a booking on Galloway Getaways.';

type Mail = { to: string; subject: string; html: string };

async function authEmail(admin: any, userId: string | null | undefined): Promise<string> {
    if (!userId) return '';
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = (data && data.user && data.user.email) || '';
    // An erased account is never written to.
    return /@invalid\.example$/i.test(email) ? '' : email;
}

async function listingTitle(admin: any, listingId: string | null | undefined): Promise<string> {
    if (!listingId) return 'your listing';
    const { data } = await admin.from('listings').select('title').eq('id', listingId).maybeSingle();
    return (data && data.title) || 'your listing';
}

// ----------------------------------------------------------- chargebacks

export function chargebackMail(input: {
    stage: 'opened' | 'closed';
    outcome?: string | null;
    listingTitle: string;
    amount: number;
    bookingId: string;
}): { subject: string; html: string } {
    const where = escapeHtml(input.listingTitle);
    const link = button(SITE_URL + '/dashboard/bookings/' + input.bookingId, 'View the booking');
    if (input.stage === 'opened') {
        return {
            subject: 'A guest’s bank has disputed a payment — ' + input.listingTitle,
            html: emailLayout(
                H('A payment has been disputed') +
                P('The guest’s bank has raised a dispute (a chargeback) about the ' + formatGBP(input.amount) + ' paid for their booking at ' + where + '.') +
                P('We’re handling it with the bank. You don’t need to do anything unless we get in touch.') +
                link,
                HOST_FOOT,
            ),
        };
    }
    const won = input.outcome === 'won';
    const lost = input.outcome === 'lost';
    return {
        subject: (won ? 'The disputed payment was settled in our favour' : lost ? 'The disputed payment went the guest’s way' : 'The payment dispute has closed')
            + ' — ' + input.listingTitle,
        html: emailLayout(
            H(won ? 'Dispute closed in our favour' : lost ? 'Dispute closed in the guest’s favour' : 'Dispute closed') +
            P('The guest’s bank has closed its dispute about the ' + formatGBP(input.amount) + ' paid for the booking at ' + where + '.') +
            P(won
                ? 'The bank decided in our favour, so the payment stands.'
                : lost
                    ? 'The bank decided in the guest’s favour. We’ll be in touch if it affects your payout.'
                    : 'We’ll be in touch if there’s anything you need to know.') +
            link,
            HOST_FOOT,
        ),
    };
}

// The same, for an EXPERIENCE (a dispute tied to a service order): to the
// provider's contact address, linking to their earnings — the twin of a host's
// chargeback email. Its own subjects (a host's say "— <listing>") so the push
// rule can copy it to co-hosts with the earnings permission (team rule).
const PROVIDER_FOOT = 'You’re receiving this because you run an experience on Galloway Getaways.';

export function providerChargebackMail(input: {
    stage: 'opened' | 'closed';
    outcome?: string | null;
    what: string;
    date: string | null;
    amount: number;
}): { subject: string; html: string } {
    const what = escapeHtml(input.what);
    const when = input.date ? ' on ' + ukDate(input.date) : '';
    const link = button(SITE_URL + '/services/dashboard/earnings', 'View your earnings');
    if (input.stage === 'opened') {
        return {
            subject: 'A guest’s bank has disputed a payment for ' + input.what,
            html: emailLayout(
                H('A payment has been disputed') +
                P('The guest’s bank has raised a dispute (a chargeback) about the ' + formatGBP(input.amount) + ' paid for ' + what + when + '.') +
                P('We’re handling it with the bank. You don’t need to do anything unless we get in touch. If your share for this booking hasn’t been paid out yet, we hold it until the dispute is settled.') +
                link,
                PROVIDER_FOOT, undefined, NEUTRAL_SUBTITLE,
            ),
        };
    }
    const won = input.outcome === 'won';
    const lost = input.outcome === 'lost';
    return {
        subject: 'The payment dispute for ' + input.what + ' has closed',
        html: emailLayout(
            H(won ? 'Dispute closed in our favour' : lost ? 'Dispute closed in the guest’s favour' : 'Dispute closed') +
            P('The guest’s bank has closed its dispute about the ' + formatGBP(input.amount) + ' paid for ' + what + when + '.') +
            P(won
                ? 'The bank decided in our favour, so the payment stands.'
                : lost
                    ? 'The bank decided in the guest’s favour. We’ll be in touch if it affects your payout.'
                    : 'We’ll be in touch if there’s anything you need to know.') +
            link,
            PROVIDER_FOOT, undefined, NEUTRAL_SUBTITLE,
        ),
    };
}

// ----------------------------------------------------------- money request declined

export function moneyDeclinedMail(input: { amount: number; listingTitle: string; bookingId: string }): { subject: string; html: string } {
    return {
        subject: 'Your guest declined your request for ' + formatGBP(input.amount),
        html: emailLayout(
            H('Your request was declined') +
            P('Your guest at ' + escapeHtml(input.listingTitle) + ' declined your request for ' + formatGBP(input.amount) + '.') +
            P('We’ve passed it to our team to look at, and we’ll be in touch with both of you.') +
            button(SITE_URL + '/dashboard/bookings/' + input.bookingId, 'View the booking'),
            HOST_FOOT,
        ),
    };
}

// ----------------------------------------------------------- experience lapses

export function orderLapsedMails(input: { orderId: string; what: string; business: string; guestFirst: string; date: string }): { guest: { subject: string; html: string }; provider: { subject: string; html: string } } {
    const when = input.date ? ' on ' + ukDate(input.date) : '';
    return {
        guest: {
            subject: 'Your request to ' + input.business + ' has expired',
            html: emailLayout(
                H('Your request expired') +
                P(escapeHtml(input.business) + ' didn’t reply to your request for ' + escapeHtml(input.what) + when + ' in time, so it has lapsed.') +
                P('The hold on your card has been released. You haven’t been charged.') +
                button(SITE_URL + '/experiences/order/' + input.orderId, 'View the request'),
                ORDER_FOOT, undefined, NEUTRAL_SUBTITLE,
            ),
        },
        provider: {
            subject: 'A booking request expired',
            html: emailLayout(
                H('A booking request expired') +
                P(escapeHtml(input.guestFirst) + '’s request for ' + escapeHtml(input.what) + when + ' wasn’t answered in time, so it has lapsed and the hold on their card was released.') +
                button(SITE_URL + '/services/dashboard', 'Open your dashboard'),
                ORDER_FOOT, undefined, NEUTRAL_SUBTITLE,
            ),
        },
    };
}

export function dateChangeLapsedMails(input: { orderId: string; what: string; business: string; guestFirst: string; askedBy: 'guest' | 'provider'; askedDate: string; date: string }): { guest: { subject: string; html: string }; provider: { subject: string; html: string } } {
    const stays = 'The booking stays on ' + ukDate(input.date) + '.';
    const asked = ukDate(input.askedDate);
    const byGuest = input.askedBy === 'guest';
    return {
        guest: {
            subject: byGuest ? 'Your date change request expired' : 'The new date ' + input.business + ' suggested has expired',
            html: emailLayout(
                H(byGuest ? 'Your date change request expired' : 'A suggested date expired') +
                P((byGuest
                    ? escapeHtml(input.business) + ' didn’t answer your request to move ' + escapeHtml(input.what) + ' to ' + asked + ' in time.'
                    : 'You didn’t answer ' + escapeHtml(input.business) + '’s suggestion to move ' + escapeHtml(input.what) + ' to ' + asked + ' in time.') + ' ' + stays) +
                button(SITE_URL + '/experiences/order/' + input.orderId, 'View your booking'),
                ORDER_FOOT, undefined, NEUTRAL_SUBTITLE,
            ),
        },
        provider: {
            subject: byGuest ? 'A guest’s date change request expired' : 'Your suggested date expired',
            html: emailLayout(
                H(byGuest ? 'A date change request expired' : 'Your suggested date expired') +
                P((byGuest
                    ? escapeHtml(input.guestFirst) + '’s request to move ' + escapeHtml(input.what) + ' to ' + asked + ' wasn’t answered in time.'
                    : escapeHtml(input.guestFirst) + ' didn’t answer your suggestion to move ' + escapeHtml(input.what) + ' to ' + asked + ' in time.') + ' ' + stays) +
                button(SITE_URL + '/services/dashboard', 'Open your dashboard'),
                ORDER_FOOT, undefined, NEUTRAL_SUBTITLE,
            ),
        },
    };
}

// ----------------------------------------------------------- deactivation

export function deactivatedMail(by: 'self' | 'suspended'): { subject: string; html: string } {
    if (by === 'self') {
        return {
            subject: 'Your account has been deactivated',
            html: emailLayout(
                H('Your account has been deactivated') +
                P('You’ve deactivated your Galloway Getaways account. Your listings are hidden and you’ve been signed out.') +
                P('If you didn’t do this, or you’d like to come back, reply to this email and we’ll help.'),
                'You’re receiving this because it’s about your account.', undefined, NEUTRAL_SUBTITLE,
            ),
        };
    }
    return {
        subject: 'Your account has been suspended',
        html: emailLayout(
            H('Your account has been suspended') +
            P('We’ve suspended your Galloway Getaways account, so you can’t sign in and your listings are hidden.') +
            P('If you think this is a mistake, reply to this email and we’ll look into it.'),
            'You’re receiving this because it’s about your account.', undefined, NEUTRAL_SUBTITLE,
        ),
    };
}

// ----------------------------------------------------------- the handler

async function firstName(admin: any, userId: string | null | undefined): Promise<string> {
    if (!userId) return 'Your guest';
    const { data } = await admin.from('profiles').select('first_name, preferred_name').eq('id', userId).maybeSingle();
    return ((data && (data.preferred_name || data.first_name)) || 'Your guest').trim();
}

async function orderParts(admin: any, orderId: string) {
    const { data: o } = await admin
        .from('service_orders')
        .select('id, guest_id, guest_email, provider_id, item_name, provider_name, service_date')
        .eq('id', orderId)
        .maybeSingle();
    if (!o) return null;
    const { data: p } = await admin.from('service_providers').select('business_name, contact_email').eq('id', o.provider_id).maybeSingle();
    return {
        o,
        business: (p && p.business_name) || o.provider_name || 'The provider',
        providerEmail: (p && p.contact_email) || '',
        guestEmail: o.guest_email || await authEmail(admin, o.guest_id),
        guestFirst: await firstName(admin, o.guest_id),
        what: o.item_name || 'your booking',
    };
}

/** The push job's handler for 'notify.*' rows. Null for any other row. */
export async function eventMail(admin: any, row: any): Promise<RowOutcome | null> {
    if (!row || typeof row.kind !== 'string' || !row.kind.startsWith('notify.')) return null;
    const ctx = row.context || {};
    const mails: Mail[] = [];

    if (row.kind === 'notify.chargeback') {
        const { data: d } = await admin.from('disputes').select('id, booking_id, order_id, amount, status').eq('id', ctx.dispute_id).maybeSingle();
        if (!d || (!d.booking_id && !d.order_id)) return { status: 'skipped', result: { reason: 'no booking on the dispute' } };
        const stage = ctx.stage === 'closed' ? 'closed' : 'opened';
        if (d.booking_id) {
            const { data: b } = await admin.from('bookings').select('id, host_id, listing_id').eq('id', d.booking_id).maybeSingle();
            const to = await authEmail(admin, b && b.host_id);
            if (b && to) {
                const m = chargebackMail({ stage, outcome: d.status, listingTitle: await listingTitle(admin, b.listing_id), amount: Number(d.amount || 0), bookingId: b.id });
                mails.push({ to, ...m });
            }
        } else {
            // An experience: the provider, at their contact address.
            const parts = await orderParts(admin, d.order_id);
            if (parts && parts.providerEmail) {
                mails.push({ to: parts.providerEmail, ...providerChargebackMail({ stage, outcome: d.status, what: parts.what, date: parts.o.service_date || null, amount: Number(d.amount || 0) }) });
            }
        }
    } else if (row.kind === 'notify.money_declined') {
        const { data: r } = await admin.from('booking_resolutions').select('id, booking_id, host_id, amount').eq('id', ctx.resolution_id).maybeSingle();
        const { data: b } = r ? await admin.from('bookings').select('listing_id').eq('id', r.booking_id).maybeSingle() : { data: null };
        const to = await authEmail(admin, r && r.host_id);
        if (r && to) mails.push({ to, ...moneyDeclinedMail({ amount: Number(r.amount || 0), listingTitle: await listingTitle(admin, b && b.listing_id), bookingId: r.booking_id }) });
    } else if (row.kind === 'notify.order_lapsed' || row.kind === 'notify.date_change_lapsed') {
        const parts = await orderParts(admin, ctx.order_id);
        if (!parts) return { status: 'skipped', result: { reason: 'order gone' } };
        const both = row.kind === 'notify.order_lapsed'
            ? orderLapsedMails({ orderId: parts.o.id, what: parts.what, business: parts.business, guestFirst: parts.guestFirst, date: parts.o.service_date })
            : dateChangeLapsedMails({ orderId: parts.o.id, what: parts.what, business: parts.business, guestFirst: parts.guestFirst, askedBy: ctx.asked_by === 'provider' ? 'provider' : 'guest', askedDate: ctx.asked_date, date: parts.o.service_date });
        if (parts.guestEmail) mails.push({ to: parts.guestEmail, ...both.guest });
        if (parts.providerEmail) mails.push({ to: parts.providerEmail, ...both.provider });
    } else if (row.kind === 'notify.deactivated') {
        const to = await authEmail(admin, ctx.user_id);
        if (to) mails.push({ to, ...deactivatedMail(ctx.by === 'self' ? 'self' : 'suspended') });
    } else {
        return { status: 'skipped', result: { reason: 'unknown event' } };
    }

    if (mails.length === 0) return { status: 'skipped', result: { reason: 'nobody to tell' } };
    const sent: boolean[] = [];
    for (const m of mails) sent.push(await sendEmail(m.to, m.subject, m.html));
    return { status: sent.some(Boolean) ? 'sent' : 'failed', result: { emails: mails.length, delivered: sent.filter(Boolean).length } };
}

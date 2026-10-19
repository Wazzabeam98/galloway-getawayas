// What push goes with each email: the category, a short Airbnb-style title and
// body, and the page a tap opens. Pure — no database, no network — so it runs
// in the email layer at no cost and can be tested exhaustively.
//
// HOW AN EMAIL BECOMES A PUSH.
//   1. The tap goes where the email's button goes (the first site link in it).
//   2. The first RULE whose subject pattern matches gives the category and
//      the words. Rules are written from the subjects the site sends today —
//      see tests/push-rules.test.ts, which holds one real subject per rule.
//   3. An email no rule knows (a new one, added later) still pushes: its
//      subject becomes the title, "Tap to see the details." the body, and the
//      category is worked out from where the tap goes. So a future email gets
//      a push without anyone touching this file — a rule just makes it nicer.
//
// WHAT A PUSH NEVER SAYS. A push shows on a lock screen. The words come from
// the subject and the rule only — never from the email body — and
// scrubPushText strips anything that looks like a door or lockbox code, wifi
// details, a postcode or a card number. Message pushes never carry the text of
// the message: any message can hold a door code.

import type { PushCategory } from './pushCategories';

export type PushSpec = {
    kind: string;
    category: PushCategory;
    title: string;
    body: string;
    url: string;
    context?: Record<string, unknown>;
    /** Which co-host permission lets a co-host see this one; absent = owner only. */
    cohost?: 'can_bookings' | 'can_messages' | 'can_calendar' | 'can_listing' | 'can_earnings';
};

const SITE = /^https?:\/\/(www\.)?gallowaygetaways\.co\.uk/i;

/** The first link in the email that points at the site, as a path. */
export function emailLink(html: string): string {
    const re = /href=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html || ''))) {
        const href = m[1].replace(/&amp;/g, '&');
        if (SITE.test(href)) {
            const path = href.replace(SITE, '') || '/';
            // Never an unsubscribe link: that is not where the news is.
            if (/^\/unsubscribe/.test(path)) continue;
            return path.startsWith('/') ? path : '/' + path;
        }
        if (href.startsWith('/') && !href.startsWith('//')) return href;
    }
    return '/';
}

/** Strips the site name and decoration from a subject. */
export function cleanSubject(subject: string): string {
    return String(subject || '')
        .replace(/\s*[—–-]\s*Galloway Getaways\s*$/i, '')
        .replace(/^Galloway Getaways\s*[:—–-]\s*/i, '')
        .replace(/&rsquo;/g, '’').replace(/&#39;|&#x27;/g, '\u2019').replace(/&quot;/g, '"').replace(/&pound;/g, '\u00a3').replace(/&amp;/g, '&')
        .trim();
}

/**
 * The last line of defence: nothing on a lock screen that could let someone
 * into a property, onto its wifi, to its door, or into a card.
 */
export function scrubPushText(text: string, max: number): string {
    let t = String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    t = t
        // "door code 4821", "lockbox: 1234", "key safe code is 0000", "wifi password xyz"
        .replace(/\b(door|lock ?box|key ?safe|keysafe|gate|access|entry|alarm|wi-?fi|wireless|network|password|passcode|pin|code)\b[^.,;!?]*?[:=]?\s*[A-Za-z0-9#*\-]{3,}\d[A-Za-z0-9#*\-]*/gi, '$1 …')
        // a run of 4+ digits that isn't a year or a date (codes, card numbers)
        .replace(/\b(?!(?:19|20)\d{2}\b)\d{4,}\b/g, '…')
        // card numbers written with spaces or dashes
        .replace(/\b(?:\d[ -]?){12,19}\b/g, '…')
        // UK postcodes
        .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '…');
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** The category an email belongs to, from where its button goes. */
export function categoryForPath(path: string): PushCategory {
    const p = path.split('?')[0];
    if (/^\/admin/.test(p)) return 'admin';
    if (/^\/messages/.test(p)) return 'messages';
    if (/^\/review/.test(p) || /\/reviews/.test(p)) return 'reviews';
    if (/^\/(payouts|resolutions)/.test(p) || /\/earnings/.test(p) || /payout|refund|dispute/.test(p)) return 'payments';
    if (/^\/(edit-listing|addhome)/.test(p) || /\/calendar/.test(p) || /^\/services\/(join|dashboard\/(listing|billing|editor))/.test(p)) return 'listings';
    if (/^\/account/.test(p)) return 'account';
    return 'reservations';
}

type Rule = {
    kind: string;
    match: RegExp;
    category: PushCategory;
    title: string | ((m: RegExpMatchArray, subject: string) => string);
    body: string | ((m: RegExpMatchArray, subject: string) => string);
    cohost?: PushSpec['cohost'];
};

// Ordered: the first match wins, so put the specific ones first.
// $1, $2 in a string title/body are the subject pattern's groups.
const D = '\\s*[\u2014\u2013-]\\s*';   // the dash between parts of a subject
const Q = '[\u2019\']';                // either apostrophe
const M = '(\u00a3[\\d,.]+)';           // an amount
const R = (src: string) => new RegExp(src.replace(/—/g, D).replace(/’/g, Q).replace(/£/g, M), 'i');

export const RULES: Rule[] = [
    // ------------------------------------------------ holiday lets: bookings
    { kind: 'stay.request.host', match: R('^New booking request—(.+)$'), category: 'reservations', title: 'New booking request', body: '$1. Accept or decline it soon.', cohost: 'can_bookings' },
    { kind: 'stay.booked.host', match: R('^New booking—(.+)$'), category: 'reservations', title: 'New booking', body: '$1. The dates are confirmed.', cohost: 'can_bookings' },
    { kind: 'stay.booked.guest', match: R('^You’re booked$'), category: 'reservations', title: 'You\u2019re booked!', body: 'Your stay is confirmed. Tap for your trip details.' },
    { kind: 'stay.request_sent.guest', match: R('^Request received$'), category: 'reservations', title: 'Request sent', body: 'We\u2019ll let you know as soon as your host replies.' },
    { kind: 'stay.oversold.guest', match: R('^We’re sorry—those dates went'), category: 'payments', title: 'Those dates were just taken', body: 'You\u2019ve been refunded in full.' },
    { kind: 'stay.trade_clash.host', match: R('^A booking landed on a day you’ve got work coming—(.+)$'), category: 'reservations', title: 'Booking on a work day', body: '$1. A trade visit is planned that day.', cohost: 'can_calendar' },
    { kind: 'stay.declined.guest', match: R('^Your booking request wasn’t accepted$'), category: 'reservations', title: 'Request declined', body: 'Your host can\u2019t take this booking. Anything you paid is refunded.' },
    { kind: 'stay.cancelled_by_host.guest', match: R('^Your booking has been cancelled$'), category: 'reservations', title: 'Booking cancelled', body: 'Your host cancelled your stay. You\u2019ve been refunded.' },
    { kind: 'stay.cancelled.guest', match: R('^Your booking at (.+) has been cancelled$'), category: 'reservations', title: 'Booking cancelled', body: 'Your stay at $1 is cancelled.' },
    { kind: 'stay.cancelled.host', match: R('^Reservation cancelled—(.+)$'), category: 'reservations', title: 'Reservation cancelled', body: '$1. The dates are open again.', cohost: 'can_bookings' },
    { kind: 'stay.balance_cancel.host', match: R('^Booking cancelled—balance unpaid$'), category: 'reservations', title: 'Booking cancelled', body: 'The guest didn\u2019t pay the balance, so the dates are open again.', cohost: 'can_bookings' },
    // changes and extensions
    { kind: 'stay.updated.host', match: R('^(.+) updated their booking at (.+)$'), category: 'reservations', title: 'Booking updated', body: '$1 changed their stay at $2.', cohost: 'can_bookings' },
    { kind: 'stay.change_proposed.guest', match: R('^Your host proposed a change to your stay$'), category: 'reservations', title: 'Your host proposed a change', body: 'Take a look and accept or decline.' },
    { kind: 'stay.change_requested.host', match: R('^Your guest requested a change to their stay$'), category: 'reservations', title: 'Change requested', body: 'Your guest wants to change their stay. Accept or decline.', cohost: 'can_bookings' },
    { kind: 'stay.change_closed.host', match: R('^A change was (declined|cancelled)$'), category: 'reservations', title: 'Change $1', body: 'The reservation stays as it was.', cohost: 'can_bookings' },
    { kind: 'stay.change_closed.guest', match: R('^Your host (declined|withdrew) the change$'), category: 'reservations', title: 'Your host $1 the change', body: 'Your booking stays as it was.' },
    { kind: 'stay.change_approved.guest', match: R('^Your host approved your change'), category: 'reservations', title: 'Change approved', body: 'Pay the difference to confirm your new dates.' },
    { kind: 'stay.change_accepted', match: R('^A reservation change was accepted$'), category: 'reservations', title: 'Change accepted', body: 'The reservation has been updated.', cohost: 'can_bookings' },
    { kind: 'stay.change_paid.host', match: R('^Your guest paid for the change$'), category: 'reservations', title: 'Change confirmed', body: 'Your guest paid and the new dates are booked.', cohost: 'can_bookings' },
    { kind: 'stay.change_failed.guest', match: R('^Your change couldn’t be made'), category: 'reservations', title: 'Your change couldn\u2019t be made', body: 'Those dates were taken, so you\u2019ve been refunded.' },
    // ------------------------------------------------ holiday lets: money
    { kind: 'stay.money_request.guest', match: R('^A payment request for (.+?)—£$'), category: 'payments', title: 'Payment request', body: '$2 for $1. Tap to see what it\u2019s for.' },
    { kind: 'stay.money_request.guest', match: R('^Your host has requested £'), category: 'payments', title: 'Your host requested $1', body: 'See what it\u2019s for and respond.' },
    { kind: 'stay.money_paid.host', match: R('^Your guest paid £'), category: 'payments', title: 'Your guest paid $1', body: 'Your money request is settled.', cohost: 'can_earnings' },
    { kind: 'stay.money_counter.host', match: R('^Your guest suggested £'), category: 'payments', title: 'Your guest suggested $1', body: 'Accept it or decline.', cohost: 'can_earnings' },
    { kind: 'stay.money_counter_accepted.guest', match: R('^Your suggested amount was accepted'), category: 'payments', title: 'Your suggestion was accepted', body: 'Tap to pay and settle it.' },
    { kind: 'stay.money_withdrawn.guest', match: R('^A money request was withdrawn'), category: 'payments', title: 'Money request withdrawn', body: 'There\u2019s nothing to pay.' },
    { kind: 'stay.money_resolved', match: R('^A money request was resolved$'), category: 'payments', title: 'Money request resolved', body: 'We\u2019ve made a decision. Tap to see it.' },
    { kind: 'stay.money_sent.guest', match: R('^Your host has sent you £'), category: 'payments', title: 'Your host sent you $1', body: 'It\u2019s on its way back to your card.' },
    { kind: 'stay.refund.guest', match: R('^Your host has refunded you £'), category: 'payments', title: 'You\u2019ve been refunded $1', body: 'It should reach your card in 5\u201310 days.' },
    { kind: 'refund.guest', match: R('^You’ve been refunded £'), category: 'payments', title: 'You\u2019ve been refunded $1', body: 'It should reach your card in 5\u201310 days.' },
    { kind: 'stay.balance_paid.guest', match: R('^Payment received—you’re all paid up for (.+)$'), category: 'payments', title: 'Payment received', body: 'You\u2019re all paid up for $1.' },
    { kind: 'stay.balance_sca.guest', match: R('^Your bank needs you to confirm a payment$'), category: 'payments', title: 'Confirm your payment', body: 'Your bank needs you to approve the balance for your stay.' },
    { kind: 'stay.balance_failed.guest', match: R('^We couldn’t take the balance for your stay$'), category: 'payments', title: 'Payment didn\u2019t go through', body: 'Update your card so your stay isn\u2019t cancelled.' },
    { kind: 'stay.balance_final.guest', match: R('^Reminder: your booking will be cancelled without payment'), category: 'payments', title: 'Your booking will be cancelled', body: 'Pay the balance now to keep your stay.' },
    { kind: 'payout.netted', match: R('^Your payout went towards what you owed$'), category: 'payments', title: 'Payout put towards what you owed', body: 'Tap to see your earnings.' },
    { kind: 'payout.sent', match: R('^You’ve been paid £'), category: 'payments', title: 'You\u2019ve been paid $1', body: 'Your payout is on its way to your bank.', cohost: 'can_earnings' },
    { kind: 'debt.paid.host', match: R('^Thanks—£ paid$'), category: 'payments', title: 'Payment received', body: 'Thanks \u2014 $1 paid.' },
    { kind: 'debt.refunded.host', match: R('^Your payment has been refunded$'), category: 'payments', title: 'Payment refunded', body: 'Tap to see your earnings.' },
    { kind: 'debt.owed.host', match: R('^£ owed to Galloway Getaways$'), category: 'payments', title: 'You owe $1', body: 'Pay it from your earnings page.' },
    { kind: 'debt.decided.host', match: R('^We’ve (looked at your dispute|reduced what you owe|written off)'), category: 'payments', title: 'Your dispute has been decided', body: 'Tap to see what we decided.' },
    { kind: 'payout.setup.host', match: R('^You have a booking—add a payout method'), category: 'listings', title: 'Add a payout method', body: 'You have a booking. Add your bank details so we can pay you.' },
    { kind: 'payout.setup.host', match: R('^Your guest arrives (.+?)—add a payout method'), category: 'listings', title: 'Add a payout method', body: 'Your guest arrives $1. Add your bank details so we can pay you.' },
    { kind: 'payout.setup.provider', match: R('^You have a booking—set up payouts'), category: 'listings', title: 'Set up payouts', body: 'You have a booking. Set up payouts so we can pay you.' },
    { kind: 'payout.setup.provider', match: R('^(.+) is waiting for you—set up payouts'), category: 'listings', title: 'Money waiting for you', body: '$1 is waiting. Set up payouts to receive it.' },
    // ------------------------------------------------ holiday lets: other
    { kind: 'calendar.sync_failed', match: R('^One of your calendars has stopped syncing$'), category: 'listings', title: 'Calendar sync stopped', body: 'An imported calendar isn\u2019t syncing. Check it to avoid double bookings.', cohost: 'can_calendar' },
    { kind: 'review.request.guest', match: R('^How was your stay at (.+)\\?$'), category: 'reviews', title: 'How was your stay?', body: 'Leave a review for $1.' },
    { kind: 'message.waiting.host', match: R('^(A guest is|\\d+ guests are) waiting on a reply'), category: 'messages', title: '$1 waiting on a reply', body: 'Reply soon to keep your response rate up.', cohost: 'can_messages' },
    { kind: 'message.waiting', match: R('^(.+ (is|are) waiting on your reply|\\d+ replies are waiting on you)$'), category: 'messages', title: '$1', body: 'Tap to reply.' },
    { kind: 'trip.added', match: R('^(.+) has added you to a trip$'), category: 'reservations', title: 'You\u2019ve been added to a trip', body: '$1 added you. Tap to see the details.' },
    { kind: 'cohost.invited', match: R('^You’ve been invited to co-host (.+)$'), category: 'listings', title: 'Co-host invitation', body: 'You\u2019ve been invited to co-host $1.' },
    { kind: 'cohost.left', match: R('^(.+) has stepped down as a co-host$'), category: 'listings', title: '$1 stepped down', body: 'They\u2019re no longer a co-host.' },
    { kind: 'cohost.accepted', match: R('^(.+) has accepted your invitation$'), category: 'listings', title: '$1 is now a co-host', body: 'They can help with your listing now.' },
    { kind: 'listing.approved', match: R('^(.+) is live on Galloway Getaways$'), category: 'listings', title: 'Your listing is live!', body: '$1 is now on Galloway Getaways.' },
    { kind: 'listing.sent_back', match: R('^A few things to change on (.+)$'), category: 'listings', title: 'Your listing needs a few changes', body: 'We\u2019ve sent $1 back with notes.' },
    { kind: 'account.reactivated', match: R('^Your account is active again$'), category: 'account', title: 'Your account is active again', body: 'Welcome back.' },
    // ------------------------------------------------ experiences
    { kind: 'exp.booked.provider', match: R('^A new booking—allergy noted'), category: 'reservations', title: 'New booking \u2014 allergy noted', body: 'Read the guest\u2019s note before the day.' },
    { kind: 'exp.booked.provider', match: R('^A new booking—please read the guest’s note$'), category: 'reservations', title: 'New booking', body: 'The guest left a note. Have a read.' },
    { kind: 'exp.booked.provider', match: R('^A new booking$'), category: 'reservations', title: 'New booking', body: 'Someone booked your experience.' },
    { kind: 'exp.booked.guest', match: R('^Your booking is confirmed$'), category: 'reservations', title: 'Booking confirmed', body: 'Your experience is booked. Tap for the details.' },
    { kind: 'exp.order_confirmed.guest', match: R('^Your order with (.+) is confirmed$'), category: 'reservations', title: 'Order confirmed', body: '$1 has your order.' },
    { kind: 'exp.order.provider', match: R('^A new order came in$'), category: 'reservations', title: 'New order', body: 'Tap to see what\u2019s been ordered.' },
    { kind: 'exp.request.provider', match: R('^A guest would like to book you'), category: 'reservations', title: 'New booking request', body: 'Accept or decline within 48 hours.' },
    { kind: 'exp.request_sent.guest', match: R('^Your request has gone to (.+)$'), category: 'reservations', title: 'Request sent', body: '$1 will reply within 48 hours.' },
    { kind: 'exp.addition.provider', match: R('^A guest wants to add to a booking$'), category: 'reservations', title: 'A guest wants to add to a booking', body: 'Tap to accept or decline.' },
    { kind: 'exp.places_added.provider', match: R('^A guest added (\\d+) places?—(.+)$'), category: 'reservations', title: 'Places added', body: 'A guest added $1 for $2.' },
    { kind: 'exp.places_added.guest', match: R('^Your added places? (is|are) confirmed$'), category: 'reservations', title: 'Extra places confirmed', body: 'Tap to see your booking.' },
    { kind: 'exp.moved.provider', match: R('^A booking moved: (.+)$'), category: 'reservations', title: 'A booking moved', body: '$1.' },
    { kind: 'exp.cascade_cancel.guest', match: R('^Your (.+) booking was cancelled with your stay$'), category: 'reservations', title: 'Experience cancelled', body: 'Your $1 booking was cancelled with your stay.' },
    { kind: 'exp.cancelled.provider', match: R('^A booking was cancelled: (.+)$'), category: 'reservations', title: 'Booking cancelled', body: 'The booking on $1 was cancelled.' },
    { kind: 'exp.cancelled.provider', match: R('^A booking was cancelled and refunded$'), category: 'reservations', title: 'Booking cancelled', body: 'The guest cancelled and was refunded.' },
    { kind: 'exp.cancelled.guest', match: R('^Your booking is cancelled and refunded$'), category: 'reservations', title: 'Booking cancelled', body: 'You\u2019ve been refunded in full.' },
    { kind: 'exp.cancel_request.provider', match: R('^A guest has asked to cancel$'), category: 'reservations', title: 'Cancellation request', body: 'A guest has asked to cancel. Tap to respond.' },
    { kind: 'exp.forfeit.provider', match: R('^A guest cancelled—you keep the payment$'), category: 'reservations', title: 'A guest cancelled', body: 'It was inside the cancellation window, so you keep the payment.' },
    { kind: 'exp.cancelled_by_provider.guest', match: R('^(.+) has cancelled your booking$'), category: 'reservations', title: 'Booking cancelled', body: '$1 cancelled your booking. You\u2019ll get a full refund.' },
    { kind: 'exp.confirmed.guest', match: R('^Your booking with (.+) is confirmed$'), category: 'reservations', title: 'Booking confirmed', body: '$1 confirmed your booking.' },
    { kind: 'exp.moved.guest', match: R('^(.+) moved your booking$'), category: 'reservations', title: 'Booking moved', body: '$1 moved your booking to a new date.' },
    { kind: 'exp.date_change.guest', match: R('^About the date change with (.+)$'), category: 'reservations', title: 'Date change update', body: '$1 replied about your date change.' },
    { kind: 'exp.update.guest', match: R('^About your booking with (.+)$'), category: 'reservations', title: 'Booking update', body: '$1 replied about your booking.' },
    { kind: 'exp.date_proposed.guest', match: R('^(.+) proposed a new date for your booking$'), category: 'reservations', title: 'New date proposed', body: '$1 suggested a new date. Accept or decline.' },
    { kind: 'exp.date_change.provider', match: R('^A guest wants to change a booking$'), category: 'reservations', title: 'Date change requested', body: 'A guest wants to move their booking. Accept or decline.' },
    { kind: 'exp.date_change_answer.provider', match: R('^Your date change was accepted$'), category: 'reservations', title: 'Date change accepted', body: 'The booking is on the new date.' },
    { kind: 'exp.date_change_answer.provider', match: R('^About the date change you proposed$'), category: 'reservations', title: 'Date change declined', body: 'The booking stays on the original date.' },
    { kind: 'exp.enquiry.provider', match: R('^New enquiry from (.+)$'), category: 'reservations', title: 'New enquiry from $1', body: 'They have a question before booking. Tap to reply.' },
    { kind: 'exp.invited', match: R('^(.+) has invited you to an experience$'), category: 'reservations', title: 'You\u2019re invited', body: '$1 invited you to an experience.' },
    { kind: 'exp.refunded.provider', match: R('^A booking was refunded: (.+)$'), category: 'payments', title: 'Booking refunded', body: 'A booking on $1 was refunded.' },
    { kind: 'message.order', match: R('^New message about your booking$'), category: 'messages', title: 'New message', body: 'About your booking. Tap to read it.' },
    // ------------------------------------------------ trades
    { kind: 'trade.enquiry_urgent.trade', match: R('^URGENT—a property owner in (.+?) needs you now'), category: 'reservations', title: 'Urgent job in $1', body: 'A property owner needs you now. Tap to reply.' },
    { kind: 'trade.enquiry.trade', match: R('^New enquiry—(.+?), (.+?) \\('), category: 'reservations', title: 'New enquiry: $1', body: 'A property owner in $2 needs you. Tap to reply.' },
    { kind: 'trade.enquiry_sent.host', match: R('^Sent to (.+) \\('), category: 'reservations', title: 'Enquiry sent', body: 'We\u2019ve sent it to $1.' },
    { kind: 'trade.accepted.host', match: R('^(.+) can help \\('), category: 'reservations', title: '$1 can help', body: 'They\u2019ve accepted your enquiry.' },
    { kind: 'trade.declined.host', match: R('^No luck with (.+) \\('), category: 'reservations', title: '$1 can\u2019t help', body: 'Try another tradesperson.' },
    { kind: 'trade.details.trade', match: R('^Here are their details \\('), category: 'reservations', title: 'Job accepted', body: 'Tap for the owner\u2019s contact details.' },
    { kind: 'trade.expired.host', match: R('^No answer from (.+) \\('), category: 'reservations', title: 'No answer from $1', body: 'Try another tradesperson.' },
    { kind: 'trade.move_day.host', match: R('^(.+) asks to move the day \\('), category: 'reservations', title: '$1 asks to move the day', body: 'Accept the new day or keep the original.' },
    { kind: 'trade.day_answer.trade', match: R('^(New day agreed|Original day kept) \\('), category: 'reservations', title: '$1', body: 'Tap to see the job.' },
    { kind: 'trade.cancelled.host', match: R('^Urgent: your (.+) has cancelled (.+?)’s visit'), category: 'reservations', title: 'Visit cancelled', body: 'Your $1 cancelled $2\u2019s visit.' },
    { kind: 'trade.cancelled.host', match: R('^(.+) has cancelled \\('), category: 'reservations', title: '$1 cancelled', body: 'The job is off. Find someone else.' },
    { kind: 'trade.called_off.trade', match: R('^A job has been called off \\('), category: 'reservations', title: 'Job called off', body: 'The owner cancelled the job.' },
    { kind: 'trade.guest_clash.host', match: R('^The new day for your (.+) has a guest in the cottage'), category: 'reservations', title: 'Guest in on the new day', body: 'The new day for your $1 clashes with a stay.', cohost: 'can_calendar' },
    { kind: 'trade.job_tomorrow.trade', match: R('^Reminder—a job tomorrow \\('), category: 'reminders', title: 'Job tomorrow', body: 'You have a job tomorrow. Tap for the details.' },
    { kind: 'message.enquiry', match: R('^New message about (.+)$'), category: 'messages', title: 'New message', body: 'About $1. Tap to read it.' },
    { kind: 'trade.subscription', match: R('^(Your free period has started|A month left of your free listing|Time to add a card|A week left of your free listing|Your free period ends tomorrow|Your listing comes down in a few days)—(.+)$'), category: 'listings', title: '$1', body: '$2. Tap to manage your subscription.' },
    { kind: 'trade.payment_failed', match: R('^Your Galloway Getaways payment didn’t go through'), category: 'payments', title: 'Subscription payment failed', body: 'Update your card to keep your listing up.' },
    { kind: 'provider.verify', match: R('^Finish listing (.+) on Galloway Getaways$'), category: 'listings', title: 'Finish your listing', body: 'Tap to finish listing $1.' },
    { kind: 'provider.approved', match: R('^You are listed on Galloway Getaways$'), category: 'listings', title: 'You\u2019re listed!', body: 'Your listing is live on Galloway Getaways.' },
    { kind: 'provider.declined', match: R('^About your Galloway Getaways listing$'), category: 'listings', title: 'About your listing', body: 'We\u2019ve looked at your application. Tap to read our note.' },
    { kind: 'provider.changes_ok', match: R('^Your changes have been checked$'), category: 'listings', title: 'Changes approved', body: 'Your updated listing is live.' },
    { kind: 'provider.changes_back', match: R('^About the changes to your listing$'), category: 'listings', title: 'Changes need another look', body: 'Tap to read our note.' },
    // ------------------------------------------------ owner alerts (sent to admins)
    { kind: 'admin.chargeback', match: R('^Chargeback (opened|resolved in our favour|lost)—£'), category: 'admin', title: 'Chargeback $1', body: '$2. Tap to see it.' },
    { kind: 'admin.money_alert', match: R('^Money alert: (.+)$'), category: 'admin', title: 'Money alert', body: '$1' },
    { kind: 'admin.dispute', match: R('^(Dispute raised|Disputed|Escalated|A money request escalated)'), category: 'admin', title: '$1', body: 'Needs a decision. Tap to see it.' },
    { kind: 'admin.provider_waiting', match: R('^(New business waiting|Sent back for review|Changes to look at): (.+)$'), category: 'admin', title: '$1', body: '$2 is waiting for approval.' },
    { kind: 'admin.enquiry', match: R('^(EMERGENCY|Enquiry|Accepted|Declined|No answer): (.+)$'), category: 'admin', title: 'Trade enquiry: $1', body: '$2' },
    { kind: 'admin.wanted', match: R('^Wanted: (.+)$'), category: 'admin', title: 'Trade wanted', body: '$1' },
    { kind: 'admin.interest', match: R('^New interest—(.+?):'), category: 'admin', title: 'New sign-up interest', body: '$1' },
    { kind: 'admin.digest', match: R('^(\\d+ things? went wrong on the site yesterday|A database restore drill failed|The database restore drill is overdue|\\d+ business(es)? (is|are) waiting on you to review|\\d+ tradesm[ae]n (is|are) waiting on themselves|Email allowance: .+)$'), category: 'admin', title: '$1', body: 'Tap to see it.' },
    { kind: 'admin.report', match: R('^(Listing|Trade|Experience) reported—(.+)$'), category: 'admin', title: '$1 reported', body: '$2' },
];

function fill(t: Rule['title'], m: RegExpMatchArray, subject: string): string {
    if (typeof t === 'function') return t(m, subject);
    return t.replace(/\$(\d)/g, (_x, n) => (m[Number(n)] || '').trim());
}

/** The push for an email, or null for one that should never push. */
export function pushForEmail(subject: string, html: string): PushSpec | null {
    const clean = cleanSubject(subject);
    if (!clean) return null;
    const url = emailLink(html);
    for (const rule of RULES) {
        const m = clean.match(rule.match);
        if (!m) continue;
        return {
            kind: rule.kind,
            category: rule.category,
            title: fill(rule.title, m, clean),
            body: fill(rule.body, m, clean),
            url,
            cohost: rule.cohost,
        };
    }
    // An email nobody wrote a rule for yet: still a push.
    return {
        kind: 'email.other',
        category: categoryForPath(url),
        title: clean,
        body: 'Tap to see the details.',
        url,
    };
}

// Every push the site sends, in one list: a real sample of each email (run
// through the same rules the live emails are) and each event that has no email.
// Drives the admin test page (/admin/notifications — one test of each), the
// coverage test (every rule has a sample here, and every sample finds its
// rule), and the event-by-event table in the pull request.

import type { PushMessage } from './push';
import type { PushCategory } from './pushCategories';
import { pushForEmail } from './pushRules';

export type Side = 'Holiday lets' | 'Experiences' | 'Trades' | 'Account' | 'Owner alerts';

export type CatalogueEntry = {
    id: string;
    side: Side;
    event: string;
    who: string;
    /** For an email: its subject and button link; the push comes from the rules. */
    subject?: string;
    link?: string;
    /** For an event with no email: the push as the job sends it. */
    push?: { category: PushCategory; title: string; body: string; url: string };
};

const E = (side: Side, event: string, who: string, subject: string, link: string): CatalogueEntry =>
    ({ id: '', side, event, who, subject, link });
const V = (side: Side, event: string, who: string, category: PushCategory, title: string, body: string, url: string): CatalogueEntry =>
    ({ id: '', side, event, who, push: { category, title, body, url } });

const B = '/dashboard/bookings/00000000-0000-4000-8000-000000000001';

const LIST: CatalogueEntry[] = [
    // ---- holiday lets
    E('Holiday lets', 'Booking request received', 'Host', 'New booking request — Rowan Cottage', B),
    E('Holiday lets', 'Instant booking', 'Host', 'New booking — Rowan Cottage', B),
    E('Holiday lets', 'Booking confirmed (instant, or host accepts)', 'Guest', 'You’re booked — Galloway Getaways', '/trips'),
    E('Holiday lets', 'Request sent and paid', 'Guest', 'Request received — Galloway Getaways', '/trips'),
    E('Holiday lets', 'Request declined', 'Guest', 'Your booking request wasn’t accepted — Galloway Getaways', '/trips'),
    E('Holiday lets', 'Host cancels', 'Guest', 'Your booking has been cancelled — Galloway Getaways', '/trips'),
    E('Holiday lets', 'Guest cancels (guest receipt)', 'Guest', 'Your booking at Rowan Cottage has been cancelled', '/trips'),
    E('Holiday lets', 'Guest cancels', 'Host', 'Reservation cancelled — Rowan Cottage', B),
    E('Holiday lets', 'Balance unpaid, stay cancelled', 'Host', 'Booking cancelled — balance unpaid', '/dashboard/bookings'),
    E('Holiday lets', 'Dates taken while paying (refunded)', 'Guest', 'We’re sorry — those dates went while you were paying', '/'),
    E('Holiday lets', 'Booking lands on a planned trade day', 'Host', 'A booking landed on a day you’ve got work coming — Rowan Cottage', '/dashboard/calendar'),
    E('Holiday lets', 'Guest changes dates, no price difference', 'Host', 'Morag updated their booking at Rowan Cottage', B),
    E('Holiday lets', 'Host proposes a change', 'Guest', 'Your host proposed a change to your stay', '/reservations/change/00000000-0000-4000-8000-000000000002'),
    E('Holiday lets', 'Guest requests a change or extension', 'Host', 'Your guest requested a change to their stay', '/reservations/change/00000000-0000-4000-8000-000000000002'),
    E('Holiday lets', 'Change declined or cancelled', 'Host', 'A change was declined', B),
    E('Holiday lets', 'Host declines or withdraws a change', 'Guest', 'Your host declined the change', '/reservations/change/00000000-0000-4000-8000-000000000002'),
    E('Holiday lets', 'Host approves a change that costs more', 'Guest', 'Your host approved your change — pay to confirm', '/reservations/change/00000000-0000-4000-8000-000000000002'),
    E('Holiday lets', 'Change accepted', 'Host or guest', 'A reservation change was accepted', B),
    E('Holiday lets', 'Guest pays for a change', 'Host', 'Your guest paid for the change', B),
    E('Holiday lets', 'Change failed, refunded', 'Guest', 'Your change couldn’t be made — you’ve been refunded', '/trips'),
    E('Holiday lets', 'Payment request (older flow)', 'Guest', 'A payment request for Rowan Cottage — £45.00', '/messages?b=x'),
    E('Holiday lets', 'Host requests money', 'Guest', 'Your host has requested £45.00', '/resolutions/x'),
    E('Holiday lets', 'Guest pays a money request', 'Host', 'Your guest paid £45.00', B),
    E('Holiday lets', 'Guest counters a money request', 'Host', 'Your guest suggested £30.00', B),
    E('Holiday lets', 'Host accepts the counter', 'Guest', 'Your suggested amount was accepted', '/resolutions/x'),
    E('Holiday lets', 'Money request withdrawn', 'Guest', 'A money request was withdrawn', '/trips'),
    E('Holiday lets', 'Admin resolves a money dispute', 'Host and guest', 'A money request was resolved', '/trips'),
    E('Holiday lets', 'Host sends money', 'Guest', 'Your host has sent you £20.00', '/trips'),
    E('Holiday lets', 'Host refunds', 'Guest', 'Your host has refunded you £50.00', '/trips'),
    E('Holiday lets', 'Balance paid', 'Guest', 'Payment received — you’re all paid up for Rowan Cottage', '/trips'),
    E('Holiday lets', 'Balance needs bank approval', 'Guest', 'Your bank needs you to confirm a payment', '/trips?pay=x'),
    E('Holiday lets', 'Balance payment failed', 'Guest', 'We couldn’t take the balance for your stay', '/trips?pay=x'),
    E('Holiday lets', 'Final balance warning', 'Guest', 'Reminder: your booking will be cancelled without payment', '/trips?pay=x'),
    E('Holiday lets', 'Chargeback opened on a booking', 'Host', 'A guest\u2019s bank has disputed a payment \u2014 Rowan Cottage', B),
    E('Holiday lets', 'Chargeback closed', 'Host', 'The disputed payment was settled in our favour \u2014 Rowan Cottage', B),
    E('Holiday lets', 'Guest declines a money request', 'Host', 'Your guest declined your request for \u00a345.00', B),
    E('Holiday lets', 'Payout sent', 'Host', 'You’ve been paid £420.00', '/dashboard/earnings'),
    E('Holiday lets', 'Payout put towards a debt', 'Host', 'Your payout went towards what you owed', '/dashboard/earnings'),
    E('Holiday lets', 'Debt paid', 'Host', 'Thanks — £25.00 paid', '/dashboard/earnings#owed'),
    E('Holiday lets', 'Debt payment refunded', 'Host', 'Your payment has been refunded', '/dashboard/earnings#owed'),
    E('Holiday lets', 'Money owed', 'Host', '£25.00 owed to Galloway Getaways', '/dashboard/earnings#owed'),
    E('Holiday lets', 'Debt dispute decided', 'Host', 'We’ve reduced what you owe to £10.00', '/dashboard/earnings#owed'),
    E('Holiday lets', 'Payouts not set up (booking)', 'Host', 'You have a booking — add a payout method to get paid', '/payouts/setup'),
    E('Holiday lets', 'Payouts not set up (arrival close)', 'Host', 'Your guest arrives Friday — add a payout method', '/payouts/setup'),
    E('Holiday lets', 'Calendar sync failing', 'Host', 'One of your calendars has stopped syncing', '/dashboard'),
    E('Holiday lets', 'Review request', 'Guest', 'How was your stay at Rowan Cottage?', '/review/x'),
    E('Holiday lets', 'Guest waiting on a reply', 'Host', 'A guest is waiting on a reply — Galloway Getaways', '/messages?b=x'),
    E('Holiday lets', 'Added to a trip', 'Companion', 'Morag has added you to a trip', '/trip-invite/x'),
    E('Holiday lets', 'Co-host invitation', 'Invitee', 'You’ve been invited to co-host Rowan Cottage', '/invite/x'),
    E('Holiday lets', 'Co-host steps down', 'Host', 'Callum has stepped down as a co-host', '/dashboard/people'),
    E('Holiday lets', 'Co-host declines', 'Host', 'Callum declined your co-host invitation', '/dashboard/people'),
    E('Holiday lets', 'Co-host accepts', 'Host', 'Callum has accepted your invitation', '/dashboard/people'),
    E('Holiday lets', 'Listing approved', 'Host', 'Rowan Cottage is live on Galloway Getaways', '/homes/x'),
    E('Holiday lets', 'Listing sent back', 'Host', 'A few things to change on Rowan Cottage', '/dashboard'),
    // ---- experiences
    E('Experiences', 'Slot booked (allergy)', 'Provider', 'A new booking — allergy noted, please read', '/services/dashboard'),
    E('Experiences', 'Slot booked (note)', 'Provider', 'A new booking — please read the guest’s note', '/services/dashboard'),
    E('Experiences', 'Slot booked', 'Provider', 'A new booking', '/services/dashboard'),
    E('Experiences', 'Slot booking confirmed', 'Guest', 'Your booking is confirmed', '/experiences/order/x'),
    E('Experiences', 'Order confirmed', 'Guest', 'Your order with Solway Smokehouse is confirmed', '/experiences/order/x'),
    E('Experiences', 'New order', 'Provider', 'A new order came in', '/services/dashboard'),
    E('Experiences', 'Booking request', 'Provider', 'A guest would like to book you', '/services/dashboard'),
    E('Experiences', 'Request sent', 'Guest', 'Your request has gone to Solway Smokehouse', '/experiences/order/x'),
    E('Experiences', 'Guest wants to add to a booking', 'Provider', 'A guest wants to add to a booking', '/services/dashboard'),
    E('Experiences', 'Places added', 'Provider', 'A guest added 2 places — 11/12/2026', '/services/dashboard'),
    E('Experiences', 'Added places confirmed', 'Guest', 'Your added places are confirmed', '/experiences/order/x'),
    E('Experiences', 'Guest moves a booking', 'Provider', 'A booking moved: 11/12/2026 10am → 12/12/2026 2pm', '/services/dashboard'),
    E('Experiences', 'Cancelled with the stay', 'Guest', 'Your Solway Smokehouse booking was cancelled with your stay', '/trips'),
    E('Experiences', 'Cancelled with the stay', 'Provider', 'A booking was cancelled: 11/12/2026', '/services/dashboard'),
    E('Experiences', 'Guest cancels and is refunded', 'Provider', 'A booking was cancelled and refunded', '/services/dashboard'),
    E('Experiences', 'Guest cancels and is refunded', 'Guest', 'Your booking is cancelled and refunded', '/trips'),
    E('Experiences', 'Guest asks to cancel', 'Provider', 'A guest has asked to cancel', '/services/dashboard'),
    E('Experiences', 'Guest walks away', 'Provider', 'A guest cancelled — you keep the payment', '/services/dashboard'),
    E('Experiences', 'Provider cancels', 'Guest', 'Solway Smokehouse has cancelled your booking', '/experiences/order/x'),
    E('Experiences', 'Provider confirms', 'Guest', 'Your booking with Solway Smokehouse is confirmed', '/experiences/order/x'),
    E('Experiences', 'Provider moves a booking', 'Guest', 'Solway Smokehouse moved your booking', '/experiences/order/x'),
    E('Experiences', 'Provider answers a date change', 'Guest', 'About the date change with Solway Smokehouse', '/experiences/order/x'),
    E('Experiences', 'Provider declines', 'Guest', 'About your booking with Solway Smokehouse', '/experiences/order/x'),
    E('Experiences', 'Provider proposes a date', 'Guest', 'Solway Smokehouse proposed a new date for your booking', '/experiences/order/x'),
    E('Experiences', 'Guest asks to change the date', 'Provider', 'A guest wants to change a booking', '/services/dashboard'),
    E('Experiences', 'Guest accepts a proposed date', 'Provider', 'Your date change was accepted', '/services/dashboard'),
    E('Experiences', 'Guest declines a proposed date', 'Provider', 'About the date change you proposed', '/services/dashboard'),
    E('Experiences', 'Request lapsed (no answer in time)', 'Guest', 'Your request to Solway Smokehouse has expired', '/experiences/order/x'),
    E('Experiences', 'Request lapsed (no answer in time)', 'Provider', 'A booking request expired', '/services/dashboard'),
    E('Experiences', 'Guest\u2019s date change lapsed', 'Guest', 'Your date change request expired', '/experiences/order/x'),
    E('Experiences', 'Guest\u2019s date change lapsed', 'Provider', 'A guest\u2019s date change request expired', '/services/dashboard'),
    E('Experiences', 'Provider\u2019s suggested date lapsed', 'Guest', 'The new date Solway Smokehouse suggested has expired', '/experiences/order/x'),
    E('Experiences', 'Provider\u2019s suggested date lapsed', 'Provider', 'Your suggested date expired', '/services/dashboard'),
    E('Experiences', 'Enquiry before booking', 'Provider', 'New enquiry from Morag', '/services/dashboard'),
    E('Experiences', 'Invited to an experience', 'Companion', 'Morag has invited you to an experience', '/trip-invite/x'),
    E('Experiences', 'Admin refund', 'Guest', 'You’ve been refunded £35.00', '/trips'),
    E('Experiences', 'Admin refund', 'Provider', 'A booking was refunded: 11/12/2026', '/services/dashboard/earnings'),
    E('Experiences', 'Payout sent', 'Provider', 'You’ve been paid £120.00', '/services/dashboard/earnings'),
    E('Experiences', 'Payouts not set up', 'Provider', 'You have a booking — set up payouts so we can pay you', '/services/dashboard'),
    E('Experiences', 'Money held, payouts not set up', 'Provider', '£120.00 is waiting for you — set up payouts to receive it', '/services/dashboard'),
    E('Experiences', 'Calendar sync failing', 'Provider', 'One of your calendars has stopped syncing', '/services/dashboard'),
    V('Experiences', 'Order-thread message', 'Guest or provider', 'messages', 'Solway Smokehouse', 'New message from your provider', '/experiences/order/x'),
    E('Experiences', 'Chargeback opened', 'Provider', 'A guest\u2019s bank has disputed a payment for Smokehouse tasting', '/services/dashboard/earnings'),
    E('Experiences', 'Chargeback closed', 'Provider', 'The payment dispute for Smokehouse tasting has closed', '/services/dashboard/earnings'),
    E('Experiences', 'Customer waiting on a reply', 'Provider or trade', 'A customer is waiting on your reply — Galloway Getaways', '/services/messages'),
    E('Experiences', 'Sent for review', 'Provider', 'We\u2019ve got your experience \u2014 it\u2019s in review', '/services/dashboard/listing'),
    E('Experiences', 'Listed / approved', 'Provider or trade', 'You are listed on Galloway Getaways', '/services/join'),
    E('Experiences', 'Application declined', 'Provider or trade', 'About your Galloway Getaways listing', '/services/join'),
    E('Experiences', 'Changes approved', 'Provider or trade', 'Your changes have been checked', '/services/join'),
    E('Experiences', 'Changes sent back', 'Provider or trade', 'About the changes to your listing', '/services/join'),
    // ---- trades
    E('Trades', 'Sent for review', 'Trade', 'We\u2019ve got your application \u2014 it\u2019s in review', '/services/join?trade=plumber'),
    E('Trades', 'Urgent enquiry', 'Trade', 'URGENT — a property owner in Castle Douglas needs you now (GG-1234)', '/services/enquiry/x'),
    E('Trades', 'New enquiry', 'Trade', 'New enquiry — Plumber, Castle Douglas (GG-1234)', '/services/enquiry/x'),
    E('Trades', 'Enquiry sent', 'Host', 'Sent to Doon Plumbing (GG-1234)', '/dashboard/enquiries'),
    E('Trades', 'Trade accepts', 'Host', 'Doon Plumbing can help (GG-1234)', '/dashboard/enquiries'),
    E('Trades', 'Trade declines', 'Host', 'No luck with Doon Plumbing (GG-1234)', '/services'),
    E('Trades', 'Owner’s details on acceptance', 'Trade', 'Here are their details (GG-1234)', '/services/dashboard'),
    E('Trades', 'Enquiry expires', 'Host', 'No answer from Doon Plumbing (GG-1234)', '/services'),
    E('Trades', 'Trade proposes a new day', 'Host', 'Doon Plumbing asks to move the day (GG-1234)', '/dashboard/enquiries'),
    E('Trades', 'Host answers the new day', 'Trade', 'New day agreed (GG-1234)', '/services/dashboard'),
    E('Trades', 'Trade cancels (urgent)', 'Host', 'Urgent: your plumber has cancelled Friday’s visit (GG-1234)', '/services'),
    E('Trades', 'Trade cancels', 'Host', 'Doon Plumbing has cancelled (GG-1234)', '/services'),
    E('Trades', 'Host calls the job off', 'Trade', 'A job has been called off (GG-1234)', '/services/dashboard'),
    E('Trades', 'New day clashes with a stay', 'Host', 'The new day for your plumber has a guest in the cottage', '/dashboard/calendar'),
    E('Trades', 'Job tomorrow', 'Trade', 'Reminder — a job tomorrow (GG-1234)', '/messages?e=x'),
    V('Trades', 'Enquiry-thread message', 'Host or trade', 'messages', 'Doon Plumbing', 'New message from your tradesperson', '/messages/enquiry/x'),
    E('Trades', 'Trial started', 'Trade', 'Your free period has started — Doon Plumbing', '/services/dashboard'),
    E('Trades', 'Trial ending', 'Trade', 'Your free period ends tomorrow — Doon Plumbing', '/services/dashboard'),
    E('Trades', 'Subscription payment failed', 'Trade', 'Your Galloway Getaways payment didn’t go through — Doon Plumbing', '/services/dashboard'),
    E('Trades', 'Finish your application', 'Applicant', 'Finish listing Doon Plumbing on Galloway Getaways', '/services/join/finish/x'),
    // ---- owner alerts
    E('Owner alerts', 'Chargeback', 'Admins', 'Chargeback opened — £240.00', '/admin'),
    E('Owner alerts', 'Failed payment or payout', 'Admins', 'Money alert: a balance charge failed twice', '/admin/errors'),
    E('Owner alerts', 'Dispute or escalation', 'Admins', 'Dispute raised — Rowan Cottage', '/admin/resolutions'),
    E('Owner alerts', 'Provider or trade sign-up waiting', 'Admins', 'New business waiting: Doon Plumbing', '/admin/providers'),
    E('Owner alerts', 'Trade enquiry activity', 'Admins', 'Enquiry: Doon Plumbing, Castle Douglas (GG-1234)', '/admin'),
    E('Owner alerts', 'Trade wanted', 'Admins', 'Wanted: Roofer in Newton Stewart', '/admin'),
    E('Owner alerts', 'Register-interest sign-up', 'Admins', 'New interest — Holiday let: Morag', '/admin/interest'),
    E('Owner alerts', 'Listing reported', 'Admins', 'Listing reported — Rowan Cottage', '/admin/listing-reports'),
    E('Owner alerts', 'Daily error digest', 'Admins', '3 things went wrong on the site yesterday', '/admin/errors'),
    V('Owner alerts', 'Holiday let waiting for approval', 'Admins', 'admin', 'Listing waiting for approval', 'Rowan Cottage is ready to review.', '/admin/listings'),
    // ---- no email: reminders, reviews, moderation
    V('Holiday lets', 'Arrival day', 'Guest', 'reminders', 'Your stay starts today', 'Rowan Cottage · check in from 4pm. Your arrival details are in your trip.', '/trips'),
    V('Holiday lets', 'Arrival day', 'Host', 'reminders', 'Morag arrives today', 'Rowan Cottage. Make sure everything’s ready.', B),
    V('Holiday lets', 'Check-out day', 'Guest', 'reminders', 'Check-out is today', 'Rowan Cottage · leave by 10am. Safe travels!', '/trips'),
    V('Holiday lets', 'Check-out day', 'Host', 'reminders', 'Morag checks out today', 'Rowan Cottage.', B),
    V('Holiday lets', 'Request unanswered after 20 hours', 'Host', 'reminders', 'Respond to Morag’s request', 'Rowan Cottage. They’re waiting to hear if they can stay.', B),
    V('Holiday lets', 'Review request (day after check-out)', 'Host', 'reviews', 'How was Morag?', 'Leave a review while the stay is fresh in your mind.', '/dashboard/reviews'),
    V('Holiday lets', 'Review left (hidden until both write)', 'Host or guest', 'reviews', 'You have a new review', 'Write your review to read theirs.', '/dashboard/reviews'),
    V('Holiday lets', 'Review published', 'Host, guest or provider', 'reviews', 'You have a new review', 'Tap to read it.', '/dashboard/reviews'),
    V('Holiday lets', 'Host replies to a review', 'Guest', 'reviews', 'Your review got a reply', 'Tap to read it.', '/trips'),
    V('Holiday lets', 'New message (typed, scheduled check-in message, door-code update)', 'Guest, host (+co-hosts with messages)', 'messages', 'Callum', 'New message from your host', '/messages/x'),
    V('Holiday lets', 'Listing taken down by an admin', 'Host or provider', 'listings', 'Your listing has been taken down', 'Guests can’t see it for now. Contact us if you have questions.', '/dashboard'),
    V('Holiday lets', 'Listing put back up', 'Host or provider', 'listings', 'Your listing is back up', 'Guests can find and book it again.', '/dashboard'),
    V('Holiday lets', 'Listing removed', 'Host', 'listings', 'Your listing has been removed', 'Contact us if you have questions.', '/dashboard'),
    V('Experiences', 'Experience today', 'Guest', 'reminders', 'Your experience is today', 'Sea kayaking at 10am.', '/experiences/order/x'),
    V('Experiences', 'Experience today', 'Provider', 'reminders', 'You have a booking today', 'Morag · Sea kayaking at 10am.', '/services/dashboard'),
    V('Experiences', 'Request about to expire', 'Provider', 'reminders', 'Request expires soon', 'Accept or decline Morag’s request for Sea kayaking before it lapses.', '/services/dashboard'),
    V('Account', 'New sign-in', 'Everyone', 'account', 'New sign-in to your account', 'If this wasn’t you, change your password now.', '/account?section=security'),
    V('Account', 'Password changed', 'Everyone', 'account', 'Your password was changed', 'If you didn’t do this, reset your password and contact us.', '/account?section=security'),
    V('Account', 'Email address changed', 'Everyone', 'account', 'Your email address was changed', 'If you didn’t do this, contact us straight away.', '/account?section=security'),
    V('Account', 'Payout bank details changed', 'Host or provider', 'account', 'Your payout details were changed', 'If you didn’t do this, contact us straight away.', '/account?section=payments'),
    E('Account', 'Account deactivated (by the person)', 'The person', 'Your account has been deactivated', '/'),
    E('Account', 'Account suspended (by us)', 'The person', 'Your account has been suspended', '/'),
    E('Account', 'Account reactivated', 'Everyone', 'Your account is active again', '/'),
];

export const CATALOGUE: CatalogueEntry[] = LIST.map((e, i) => ({ ...e, id: 't' + String(i + 1).padStart(3, '0') }));

/** The push this entry sends, exactly as the live one would be worded. */
export function cataloguePush(e: CatalogueEntry): { category: PushCategory; title: string; body: string; url: string; kind: string; cohost?: string } | null {
    if (e.push) return { ...e.push, kind: 'event' };
    const spec = pushForEmail(e.subject || '', '<a href="https://gallowaygetaways.co.uk' + (e.link || '/') + '">Open</a>');
    return spec ? { category: spec.category, title: spec.title, body: spec.body, url: spec.url, kind: spec.kind, cohost: spec.cohost } : null;
}

/** For the admin test page: the same words, "TEST" first, opening the test page. */
export function catalogueTestPush(id: string): PushMessage | null {
    const e = CATALOGUE.find((x) => x.id === id);
    const p = e && cataloguePush(e);
    if (!p) return null;
    return { title: 'TEST ' + p.title, body: p.body, url: '/admin/notifications', tag: 'test-' + id };
}

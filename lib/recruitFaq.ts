// The "Your questions, answered" wording on the three sign-up flows
// (components/business/RecruitFaq): holiday-let hosts, guest-experience
// providers, trades.
//
// Source: Liam's "answers for recruiting hosts, experiences and trades" (4 Oct
// 2026), checked line by line against the code and the approved v1-2026-10-03
// agreements before it went up. Where the code and an agreement disagree, the
// answer is worded so it contradicts neither, and the clash is flagged for the
// solicitor rather than settled here. tests/recruit-faq.test.ts holds every
// number in here to the constant in the code that decides it — change a rate,
// a window or a fee and that test names the answer that has gone stale.
//
// Plain text only, one string per paragraph.

import { COMPANY_SENTENCE } from '../config/company';

export type FaqAudience = 'host' | 'experience' | 'trade';
export interface FaqItem { q: string; a: string[] }

const HOST: FaqItem[] = [
    {
        q: 'What does it cost me?',
        a: ['Nothing to list. We keep a 10% commission on each booking before paying you, and guests pay no booking fee on top.'],
    },
    {
        q: 'When do I get paid?',
        a: [
            'We release your share the day after the guest checks in. Stripe then pays it into your bank, which usually takes about a week. You can choose daily, weekly or monthly payouts.',
        ],
    },
    {
        q: 'How do I get paid, and is it safe?',
        a: [
            'Through Stripe. Once your listing is approved, you add your bank details and ID with Stripe, not with us, and any money from bookings waits safely until you have. When Stripe has confirmed you, your listing shows a Verified host badge.',
        ],
    },
    {
        q: 'Can I stay on Airbnb and Booking.com too?',
        a: [
            'Yes. We check your other calendars every three hours and block any dates booked there. Our calendar feed is always up to date, but how often Airbnb or Booking.com read it is up to them.',
        ],
    },
    {
        q: 'How do guests pay?',
        a: [
            'In full when they book, or, if check-in is more than 30 days away, a 25% deposit with the rest charged automatically 30 days before arrival.',
            'If the balance payment fails, we retry and remind the guest for three days, or up to a week if their bank needs them to confirm it. If it still can’t be taken, the booking is cancelled under your cancellation policy.',
        ],
    },
    {
        q: 'Can I pick my cancellation policy?',
        a: [
            'Yes, one of four:',
            'Flexible: full refund up to 1 day before check-in, 50% after that.',
            'Moderate: full refund up to 5 days before, 50% after that.',
            'Limited: full refund up to 14 days before, 50% between 7 and 14 days, nothing within 7.',
            'Firm: full refund up to 30 days before, 50% between 7 and 30 days, nothing within 7.',
            'Whatever the policy, the cleaning fee is always refunded.',
        ],
    },
    {
        q: 'Can I take a damage deposit?',
        a: ['Yes. You set the amount and it shows on your listing, but you collect, hold and return it yourself. We don’t hold it.'],
    },
    {
        q: 'Is my address public?',
        a: [
            'No. The map shows the rough area only. Guests get the exact address and directions once their booking is confirmed and paid, and the door code and wifi password close to arrival — you choose how far ahead, from 12 hours up to a week, and it defaults to 24 hours.',
        ],
    },
    {
        q: 'Can someone help me run it?',
        a: [
            'Yes. Invite a co-host and choose what they can do: the calendar, messages, bookings, editing the listing, earnings. Cancelling, refunds, payout details, hiding or deleting the listing and inviting others always stay with you.',
        ],
    },
    {
        q: 'Can I take my place off the site?',
        a: [
            'Any time. Hide it and it stops taking new bookings, while guests already booked keep their stays. A listing that has never been booked can be deleted.',
        ],
    },
    {
        q: 'What if I cancel on a guest?',
        a: [
            'The guest gets a full refund, and a cancellation fee of 5% of the booking comes off your next payout. Repeated cancellations can lead to your listings being removed.',
            'There’s no fee when a major disruptive event stops the stay — a government travel restriction, an evacuation, police or the council closing access, or a widespread loss of power or water at the property. Weather warnings on their own don’t count.',
        ],
    },
    {
        q: 'What do I need in place?',
        a: [
            'You’re responsible for holding a short-term let licence where Scotland requires one, with its number shown on your listing, having appropriate insurance, meeting fire and gas safety requirements, and paying any tax on your income. You agree to this when you accept the host terms.',
        ],
    },
    {
        q: 'What do I need to list?',
        a: [
            'A title, a nightly price, the address (a street or a property name, plus the postcode), a short description and at least five photos. We look over your first listing before it goes live.',
        ],
    },
    {
        q: 'Who are we, legally?',
        a: [
            COMPANY_SENTENCE + '. For holiday lets we act as your agent: we take the guest’s payment on your behalf, keep our commission and pay you the rest. You provide the stay. Our terms are under Scots law, and you accept them on the site when you sign up.',
        ],
    },
    {
        q: 'What if a guest damages the property?',
        a: [
            'After checkout you can ask the guest to pay for damage through the site, and we take no fee on it. If they won’t pay, it’s between you and them — that’s what the damage deposit and your own insurance are for.',
        ],
    },
    {
        q: 'What if a guest is refunded after I’ve been paid?',
        a: ['We take it back from your next payout. We don’t pass Stripe’s card fees on to you.'],
    },
];

const EXPERIENCE: FaqItem[] = [
    {
        q: 'What kind of business fits?',
        a: [
            'Anything a guest might book while they’re here: a private chef, a baker, a sauna, a class, a guided walk or a boat trip.',
            'Each works in one of three ways. Comes to you: you go to the guest, like a chef cooking at a cottage. Made to order: something made for a date, like a cake, collected or delivered. Set times: guests book a slot, like a sauna session or a class.',
        ],
    },
    {
        q: 'Who can book me?',
        a: [
            'Guests with a stay booked through Galloway Getaways can add your experience to their trip, and book and pay for it on the site.',
        ],
    },
    {
        q: 'What does it cost me?',
        a: [
            'Nothing to list. We take a commission of 10% of each booking, and the rate for your business is shown in your dashboard. If you charge a delivery fee, you keep all of it.',
        ],
    },
    {
        q: 'Who sets the price?',
        a: ['You do. The guest sees your price and your words, never a mark-up from us — our commission comes out of your share, not on top.'],
    },
    {
        q: 'How does the money work?',
        a: [
            'The guest pays through the site and we collect it on your behalf. We hold it until the experience has happened, and the day after, we send 90% to your Stripe account and keep our 10%.',
            'You’re the seller, so your business name is on the guest’s card statement.',
        ],
    },
    {
        q: 'Do I have to accept every booking?',
        a: [
            'Some are requests and some book straight away. A comes-to-you booking, or a made-to-order item you’ve marked as custom, is a request: the guest’s card is held and only charged when you confirm. If you don’t reply within 48 hours, the hold is released and nothing is taken.',
            'Standard made-to-order items and set-time slots book instantly, so only offer what you can do.',
        ],
    },
    {
        q: 'Can I take two bookings on the same day?',
        a: [
            'It depends on how you work. If you go to the guest, you take one booking per date. Made-to-order can take several for the same day. For set times, you choose how many places each slot has. We confirm this with you when we approve you.',
        ],
    },
    {
        q: 'What about allergies?',
        a: [
            'Guests can add a note when they book. Food businesses also get a separate allergy and dietary field, shown first in your email and on your dashboard.',
            'Once a booking is confirmed, you get the guest’s contact details, including their phone number if they gave one, so you can check anything.',
        ],
    },
    {
        q: 'How do I get set up?',
        a: [
            'Apply here and we review your application. Once you’re approved you’re live and guests can book you straight away. To be paid, connect your bank and verify your ID with Stripe — your share of any bookings waits safely until you have.',
        ],
    },
    {
        q: 'What if a guest cancels?',
        a: [
            'Refunds go through the site under the cancellation window you set. If the guest cancels before your cut-off, they get a full refund automatically and you aren’t paid for that booking. Inside the window, a refund is your call. If you cancel, the guest gets everything back.',
        ],
    },
    {
        q: 'Can I pause?',
        a: ['Yes, any time, with “Take it down”. Guests already booked keep their bookings and can still change them.'],
    },
    {
        q: 'Is this sold as a package holiday?',
        a: [
            'No. Stays and experiences are always booked and paid for separately, never sold together as a package. If a guest’s stay is cancelled, anything they booked to go with it is cancelled and refunded too.',
        ],
    },
    {
        q: 'Are you vouching for my business?',
        a: [
            'No. You’re responsible for your own experience, and being approved to appear on the site isn’t a guarantee of your skills or qualifications.',
        ],
    },
];

const TRADE: FaqItem[] = [
    {
        q: 'Which trades can join?',
        a: [
            'Plumbers, electricians, handymen, roofers, joiners, painters and decorators, gardeners, window cleaners and waste removal. If yours isn’t listed, choose “Something else” and tell us. Cleaning shows as coming soon and can’t be signed up for yet.',
        ],
    },
    {
        q: 'What does it cost?',
        a: ['Your first six months are free, then it’s £20 a month, with no VAT added. There’s no commission and no fee per job.'],
    },
    {
        q: 'How do I get paid for the work?',
        a: ['Directly by the host, however you normally invoice. The job money never goes through us.'],
    },
    {
        q: 'How do hosts find me?',
        a: [
            'A host picks the trade and their area, looks through profiles and sends an enquiry to one trade. You get it by email — and by text as well for an emergency, if you’ve given us a mobile — then accept or decline from the link.',
        ],
    },
    {
        q: 'What does a host see before contacting me?',
        a: [
            'Your profile and photos, the areas you cover, any rates or call-out fee you choose to publish, and any registration number you’ve given us. They don’t see your phone number or email, and nobody fills in a price for you.',
        ],
    },
    {
        q: 'When do I get the host’s details?',
        a: [
            'The enquiry tells you the town or area. When you accept, we send you the host’s name, phone number and email, and they give you the exact address.',
        ],
    },
    {
        q: 'How long do I have to answer?',
        a: [
            'It depends on how urgent the host said it was: 20 minutes for an emergency, 48 hours for soon, five days for planned work. After that the enquiry lapses and the host can ask someone else.',
        ],
    },
    {
        q: 'What happens when the free period ends?',
        a: [
            'Near the end of your free period we email you a secure link to add a card, and Stripe takes the £20 each month after that. If you haven’t added a card, you stay listed for seven days after the free period ends, then your listing is hidden until you do.',
            'If a payment fails, we email you straight away with a link to pay it or use another card. Stripe tries again and you stay listed meanwhile; if it can’t collect, your listing comes down until it’s paid. Jobs you’ve already accepted are never affected.',
        ],
    },
    {
        q: 'Can I pause?',
        a: [
            'Yes, any time, with “Take it down”. If you’re paying, the £20 pauses while you’re down and restarts when you put the listing back up. If you’re still in your free period, it keeps counting down.',
        ],
    },
    {
        q: 'Do I need a registration?',
        a: [
            'Electricians, and plumbers who work on gas or oil, must give their registration number before we approve them. It shows on your profile as provided by you — we don’t verify it — so hosts can check it themselves on the public register. If it runs out, you come off the list until it’s renewed.',
            'Being listed isn’t a guarantee of your work. Hosts should still ask for proof of insurance and qualifications, as they would anywhere else.',
        ],
    },
];

export const RECRUIT_FAQ: Record<FaqAudience, FaqItem[]> = {
    host: HOST,
    experience: EXPERIENCE,
    trade: TRADE,
};

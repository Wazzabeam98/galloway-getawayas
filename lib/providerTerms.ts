// The provider terms shown on the finish screen of the guest-experience sign-up,
// and the version stamp recorded with every acceptance.
//
// SINGLE SOURCE. The finish screen renders exactly what is here; nothing else
// holds the terms text. Swapping in a revised version later is a change to THIS
// ONE FILE: replace `sections`, and bump `PROVIDER_TERMS_VERSION` so the stamp on
// every new acceptance reflects the text they actually agreed to.
//
// ─────────────────────────────────────────────────────────────────────────────
// SOURCE + SCOPE. The text below is drawn from TERMS-DRAFT-FOR-SOLICITOR.md
// (docs/adviser-solicitor-drafts, "Prepared for the solicitor, 7 September 2026").
// That document is a WORKING DRAFT for legal review covering the whole platform
// (cottage bookings, guest experiences, tradesman introductions, subscription),
// and it states plainly that a formal guest-experience provider agreement does
// not yet exist. So this is NOT a verbatim copy of that file — it is the
// provider-relevant clauses (who we are, what the platform is, the guest-
// experience flow, and the common provisions), with the solicitor-only apparatus
// removed: the "prepared for the solicitor" front matter, the [OPEN — LEGAL] /
// [DECISION] annotation boxes, the status tags, the money-flow tables and the
// VAT/liability questions. Nothing here has been reviewed by a solicitor. The
// banner says so; it stays off production until reviewed terms are ready.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_TERMS_VERSION = 'draft-2026-09-07';

export interface TermsSection {
    heading: string;
    body: string[];
}

export interface ProviderTerms {
    version: string;
    title: string;
    // Shown at the top of the panel while the text is provisional. Empty once
    // solicitor-reviewed terms are in and this notice is no longer true.
    draftNotice: string;
    sections: TermsSection[];
}

export const PROVIDER_TERMS: ProviderTerms = {
    version: PROVIDER_TERMS_VERSION,
    title: 'Provider terms and conditions',
    draftNotice:
        'DRAFT — prepared 7 September 2026 for legal review and not yet reviewed by a '
        + 'solicitor. A formal provider agreement is still to be finalised; this wording may change.',
    sections: [
        {
            heading: 'Who we are',
            body: [
                'Galloway Getaways is operated by Galloway Getaways Ltd, a company registered in '
                + 'Scotland (company number SC899385), registered office 17b King Street, Castle '
                + 'Douglas, DG7 1AA, contactable at hello@gallowaygetaways.co.uk.',
            ],
        },
        {
            heading: 'What the platform is',
            body: [
                'The platform hosts different kinds of transaction, and they are not the same in '
                + 'how money moves. A guest experience — a chef, sauna, cake, photographer and '
                + 'similar — is sold to a guest during their stay by a third-party provider. The '
                + 'guest pays the provider through our checkout; we only ever receive our commission.',
                'You must be 18 or over to list, and you are responsible for your account and for '
                + 'giving accurate information.',
            ],
        },
        {
            heading: 'Who contracts with whom',
            body: [
                'The experience is provided by you, a third-party provider, not by us. The contract '
                + 'for the experience is between you and the guest. The guest is told this on screen '
                + 'before paying — the checkout shows: “Booked with [provider]. Galloway Getaways '
                + 'takes the payment on their behalf and is not the provider.”',
            ],
        },
        {
            heading: 'Who takes payment',
            body: [
                'You are the merchant of record. The guest’s card is charged on your behalf and the '
                + 'money settles to your own account. The receipt and card statement show you, not us.',
            ],
        },
        {
            heading: 'Our commission, and when money moves',
            body: [
                'We take 10% as a fee on your charge — a commission, not a markup; the guest pays '
                + 'exactly your own price. We never hold the rest; only our fee reaches us. Timing '
                + 'depends on the type of experience:',
                'Request experiences (e.g. a chef): the card is held, not charged, when the guest '
                + 'requests, and only charged when you confirm. If you decline or do not answer '
                + 'within 48 hours, the hold is released and nothing is taken.',
                'Instant experiences (e.g. a booked sauna session): charged on payment; the booking '
                + 'is live immediately.',
            ],
        },
        {
            heading: 'Cancellations and refunds',
            body: [
                'A guest may cancel free up to 48 hours before the experience; inside that window it '
                + 'is at your discretion. You may refund a confirmed booking at any time. A refund '
                + 'returns the full amount to the guest and reverses our fee.',
            ],
        },
        {
            heading: 'Who is responsible for the experience',
            body: [
                'You are responsible for delivering the experience, for its safety, and for your own '
                + 'legal obligations (food hygiene registration, insurance, and so on). We are not '
                + 'the provider and do not deliver the experience.',
            ],
        },
        {
            heading: 'Getting listed',
            body: [
                'You apply, prove your email, and are reviewed and approved by us before you can be '
                + 'listed or take payment; approval is a manual gate. At sign-up you declare relevant '
                + 'registrations (for example food-business registration) by entering the details; we '
                + 'may verify them later as a separate step.',
            ],
        },
        {
            heading: 'Reviews',
            body: [
                'Only guests who completed a booking may review; reviews must be honest; we may '
                + 'remove abusive or off-topic reviews.',
            ],
        },
        {
            heading: 'Our responsibility',
            body: [
                'We take reasonable care to run the platform. We do not deliver the experiences. '
                + 'Nothing limits our liability for death or personal injury caused by our '
                + 'negligence, or for fraud.',
            ],
        },
        {
            heading: 'Changes, suspension and governing law',
            body: [
                'We may suspend accounts that breach these terms or put people at risk. We may update '
                + 'these terms; the version in force at the time of a booking applies. These terms are '
                + 'governed by the law of Scotland.',
            ],
        },
    ],
};

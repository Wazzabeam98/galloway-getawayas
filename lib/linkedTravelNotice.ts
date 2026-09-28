// The linked-travel-arrangement notice shown at the experience checkout to a
// guest who already has a confirmed stay.
//
// WHY IT EXISTS. Our solicitor confirmed we are not selling a package holiday
// (an experience is only ever offered after a stay is booked and confirmed, and
// experience money settles straight to the provider, so no insolvency cover is
// engaged). But a same-visit stay-plus-experience may be a "linked travel
// arrangement" under the Package Travel Regulations 2018, which he asked us to
// handle with a notice at experience checkout. This is that notice.
//
// ONE PLACE, ON PURPOSE. The wording below is placeholder text, to be swapped
// for the solicitor's final wording when it arrives. Everything that shows the
// notice — the checkout component and, through the version, the record kept
// against each order — reads it from here, so a swap is a single edit. When you
// change the wording, BUMP `LTA_NOTICE_VERSION` so orders record which wording a
// guest actually saw.

// Bump this whenever SUMMARY or FULL changes, so the version stamped on an order
// tells you exactly which wording that guest was shown.
export const LTA_NOTICE_VERSION = 'placeholder-2026-09-28';

// The one-line notice shown collapsed, above the pay button.
export const LTA_NOTICE_SUMMARY =
    'This isn’t a package holiday — the provider is responsible for their own service.';

// The full wording, revealed when the guest expands the notice. PLACEHOLDER —
// replace with the solicitor's text (and bump LTA_NOTICE_VERSION) when it lands.
export const LTA_NOTICE_FULL =
    'Placeholder wording, to be replaced by our solicitor. Your stay and this '
    + 'experience are separate bookings. The experience is provided by an '
    + 'independent local provider, not by Galloway Getaways, and you pay that '
    + 'provider through our checkout — we act only as their agent for the payment. '
    + 'Because you are booking an experience around a stay you have already booked, '
    + 'the two together may form a "linked travel arrangement" under the Package '
    + 'Travel Regulations 2018. This is not a package holiday: the provider is '
    + 'responsible for the experience itself, including its quality and safety, and '
    + 'Galloway Getaways is not liable for the provider’s acts or omissions. Your '
    + 'money for the experience goes directly to the provider and is not held by us.';

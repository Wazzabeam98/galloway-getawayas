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
// ONE PLACE, ON PURPOSE. Everything that shows the notice — the checkout
// component and, through the version, the record kept against each order — reads
// the wording from here, so changing it is a single edit. Whenever you change
// SUMMARY or FULL, BUMP `LTA_NOTICE_VERSION` so orders record which wording a
// guest actually saw.

// Bump this whenever SUMMARY or FULL changes, so the version stamped on an order
// tells you exactly which wording that guest was shown.
export const LTA_NOTICE_VERSION = 'v1-2026-09-28';

// The one-line notice shown collapsed, above the pay button.
export const LTA_NOTICE_SUMMARY =
    'This is not a package holiday. Your experience is provided by an independent local business.';

// The full wording, revealed when the guest expands the notice.
export const LTA_NOTICE_FULL =
    'You are booking a stay and an experience separately, and they are not sold '
    + 'together as a package holiday. Your experience is provided by the local '
    + 'business named above, not by Galloway Getaways. That business is responsible '
    + 'for delivering the experience, for its safety, and for meeting its own legal '
    + 'obligations, including any insurance, licensing or food hygiene requirements. '
    + 'We take the payment on their behalf and act as an intermediary. If something '
    + 'goes wrong with the experience itself, your agreement is with the provider, '
    + 'though we will help you reach them. Your stay is a separate booking with your '
    + 'host, and cancelling or changing one does not affect the other.';

// WHICH NOTICE, WHEN BOTH COULD SHOW.
//
// A stay-linked checkout used to show this notice every time — and, since the
// package notice (lib/packageNotice.ts) arrived, both lines together whenever
// the experience date fell inside the guest's own confirmed, paid stay. Two
// notices saying overlapping things is one too many: where the package notice
// applies it is the more specific statement, so it is shown ALONE. Everywhere
// else this notice behaves exactly as before.
//
// One rule for both halves: the checkout components ask it whether to DRAW the
// line, and the routes that create the order ask it whether to RECORD
// lta_notice_* — so an order never records a notice its guest was not shown.
// `packageNoticeApplies` on the server is the route's own decision
// (packageNoticeRecord), never anything the browser sent.
export function linkedTravelNoticeApplies(stayLinked: boolean, packageNoticeApplies: boolean): boolean {
    return !!stayLinked && !packageNoticeApplies;
}

// The columns an order-creating route writes for this notice: the version and
// the server's time when the guest was shown it, or nothing when they weren't.
export function ltaNoticeRecord(
    stayLinked: boolean,
    packageNoticeApplies: boolean,
    nowIso: string,
): { lta_notice_version: string; lta_notice_shown_at: string } | Record<string, never> {
    return linkedTravelNoticeApplies(stayLinked, packageNoticeApplies)
        ? { lta_notice_version: LTA_NOTICE_VERSION, lta_notice_shown_at: nowIso }
        : {};
}

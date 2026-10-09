// Which side of the site someone is on — travelling, or their working side
// (hosting a cottage, or providing a trade or an experience). One rule, read by
// the navbar's switch, the homepage, and the landing step after sign-in
// (app/auth/land), so the three can never disagree.
//
// Airbnb's behaviour: the site remembers the side you were last on and puts you
// back there. Someone who has never chosen lands on their working side if they
// have been approved for one, and travelling otherwise. The memory is the
// gg_mode cookie the switch writes (components/base/ModeSwitch).

export type WorkMode = 'host' | 'travel';

export type WorkSide = {
    // Has any listing at all, drafts included — enough to be shown the switch.
    isHost: boolean;
    // Has a listing that was approved: live now, or live and since hidden.
    isApprovedHost: boolean;
    // Owns an approved trade or experience provider.
    isProvider: boolean;
};

export const NO_WORK_SIDE: WorkSide = { isHost: false, isApprovedHost: false, isProvider: false };

// Listing statuses that mean an owner approved it. A hidden listing was live
// and has been taken down for now; its host is still a host.
export const APPROVED_LISTING_STATUSES = ['published', 'hidden'];

export function hasWorkSide(side: WorkSide): boolean {
    return side.isHost || side.isProvider;
}

export function resolveWorkMode(cookie: string | null | undefined, side: WorkSide): WorkMode {
    // A plain guest is always travelling. The cookie lives in the browser, not
    // the account, so on a shared computer it may be someone else's choice.
    if (!hasWorkSide(side)) return 'travel';
    // The side they were last on, as the switch remembered it.
    if (cookie === 'host' || cookie === 'travel') return cookie;
    // Never chosen: approved for a working side → that side.
    return side.isApprovedHost || side.isProvider ? 'host' : 'travel';
}

// Where the working side lives. A cottage host's is their listings; a provider
// with no approved listing of their own works from the provider dashboard.
export function workHref(side: WorkSide): string {
    if (side.isApprovedHost) return '/dashboard';
    if (side.isProvider) return '/services/dashboard';
    return '/dashboard';
}

// Where to send someone once they have signed in from the account menu: their
// working side if that is the side they are on, otherwise back to the page they
// were on. `from` is already checked to be one of our own paths.
export function landingFor(cookie: string | null | undefined, side: WorkSide, from: string): string {
    return resolveWorkMode(cookie, side) === 'host' ? workHref(side) : from;
}

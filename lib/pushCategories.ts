// The push notification categories — what account settings shows a switch
// for, and what every push is filed under. Shared by the settings page (client)
// and the push job (server), so the two can never disagree.
//
// Everything is on by default except marketing. Security alerts ('account')
// always send and have no switch; 'admin' is shown to admins only.

export const PUSH_CATEGORIES = [
    'messages',
    'reservations',
    'reminders',
    'payments',
    'reviews',
    'listings',
    'account',
    'admin',
    'marketing',
] as const;

export type PushCategory = typeof PUSH_CATEGORIES[number];

export const PUSH_CATEGORY_INFO: Record<PushCategory, { label: string; description: string; defaultOn: boolean; locked?: boolean; adminOnly?: boolean }> = {
    messages: {
        label: 'Messages',
        description: 'New messages from guests, hosts, experience providers and tradespeople.',
        defaultOn: true,
    },
    reservations: {
        label: 'Bookings and requests',
        description: 'Enquiries, requests, bookings, acceptances, declines, changes, extensions and cancellations.',
        defaultOn: true,
    },
    reminders: {
        label: 'Reminders',
        description: 'Requests about to expire, arrival and check-out days, and experiences happening today.',
        defaultOn: true,
    },
    payments: {
        label: 'Payments and payouts',
        description: 'Payments, payouts, refunds, money requests and disputes.',
        defaultOn: true,
    },
    reviews: {
        label: 'Reviews',
        description: 'Reminders to write a review, and reviews you’ve received.',
        defaultOn: true,
    },
    listings: {
        label: 'Your listings and services',
        description: 'Approvals, declines, take-downs, calendar sync problems, payout setup and your subscription.',
        defaultOn: true,
    },
    account: {
        label: 'Account security',
        description: 'New sign-ins, and changes to your password, email address or payout details.',
        defaultOn: true,
        locked: true,
    },
    admin: {
        label: 'Owner alerts',
        description: 'New host, provider and trade sign-ups, anything waiting for approval, and failed payments.',
        defaultOn: true,
        adminOnly: true,
    },
    marketing: {
        label: 'Tips and offers',
        description: 'Occasional ideas for your trips and hosting. Never more than once a month.',
        defaultOn: false,
    },
};

export function isPushCategory(value: unknown): value is PushCategory {
    return typeof value === 'string' && (PUSH_CATEGORIES as readonly string[]).includes(value);
}

/** Whether this person wants pushes in this category, from their stored switches. */
export function pushAllowed(prefs: Record<string, unknown> | null | undefined, category: PushCategory): boolean {
    const info = PUSH_CATEGORY_INFO[category];
    if (info.locked) return true;
    const v = prefs ? prefs[category] : undefined;
    return typeof v === 'boolean' ? v : info.defaultOn;
}

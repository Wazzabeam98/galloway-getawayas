// The two things every owner-moderation route needs: proving the person really
// is an owner, and writing down what they did to somebody else's listing.
//
// Server-side only.
//
// Deliberately NOT part of lib/access.ts. checkListing() is used by the
// earnings, payouts, calendar, messages and bookings routes, so teaching it
// about admins would silently hand an owner every one of those with no record
// anywhere — and the host code path has no concept of a reason, so nothing
// would ever be logged. Owner powers are opted into route by route, here.

import { adminClient } from '@/lib/supabaseAdmin';

export type AdminAction =
    | 'listing_hidden'
    | 'listing_relisted'
    | 'listing_edited'
    | 'listing_photo_removed';

// The bucket a removed photo is moved into. Private: a host who disputes what
// was taken down can still be shown the file, but nobody on the internet can
// reach it.
export const REMOVED_BUCKET = 'listings-removed';

// True only for a real owner. Read with the service role because the caller
// may be looking at rows row-level security would otherwise hide from them.
//
// Note is_admin is currently readable by anyone. That is not what makes this
// safe — this is a server-side check against the signed-in user's own row, and
// reading the flag grants nothing.
export async function isAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;

    const admin = adminClient();
    const { data } = await admin
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

    return data?.is_admin === true;
}

// Writes the trail. Returns nothing anyone should branch on: if the log write
// fails the action itself has already happened, and pretending otherwise would
// be worse than a gap.
export async function recordAdminAction(entry: {
    adminId: string;
    action: AdminAction;
    listingId: string;
    hostId: string | null;
    reason: string;
    detail?: Record<string, unknown>;
}): Promise<void> {
    // Only moderation gets logged. An owner editing their own listing is a
    // host doing host things and goes down the ordinary path.
    if (entry.hostId && entry.hostId === entry.adminId) return;

    try {
        const admin = adminClient();
        await admin.from('admin_actions').insert({
            admin_id: entry.adminId,
            action: entry.action,
            listing_id: entry.listingId,
            host_id: entry.hostId,
            reason: entry.reason.trim(),
            detail: entry.detail || {},
        });
    } catch (err: any) {
        console.error('[adminAudit] could not record', entry.action, err?.message);
    }
}

// One place for the rule, so no route invents its own idea of "good enough".
export function cleanReason(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const reason = raw.trim();
    if (reason.length < 3) return null;
    return reason.slice(0, 500);
}

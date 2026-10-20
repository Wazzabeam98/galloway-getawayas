import { adminClient } from './supabaseAdmin';
import type { Permission } from './access';

// Co-hosts for a service business — a guest experience or a trade — copied from
// the holiday-let co-host system (lib/access) rather than invented again. The
// grant hangs on the PROVIDER (provider_access), not on one offering, because a
// provider's calendar, inbox, bookings, listing and earnings are all one
// business. The same five permissions, the same meaning:
//
//   can_calendar   the diary: sessions, blocks, weekly hours, imported calendars
//   can_messages   guest/host message threads and replying to reviews
//   can_bookings   bookings, enquiries and requests: accept, decline, cancel
//   can_listing    the listing editor
//   can_earnings   what the business earns
//
// A co-host given every one is FULL ACCESS — the owner's equal — except for the
// three things the owner keeps, exactly as for a holiday let: their payout bank
// details (Stripe Connect), closing the account, and the primary-owner seat. On
// top of those, the subscription and trade billing stay with the owner: they are
// the owner's card. Only the owner may grant full access.
//
// The database answers the same question in has_provider_permission() (the row
// policies behind every browser write); keep the two in step.

export type ProviderPermission = Permission;

export interface ProviderAccess {
    providerId: string;
    accessId: string | null;
    isOwner: boolean;
    role: 'owner' | 'co_host';
    can_calendar: boolean;
    can_messages: boolean;
    can_bookings: boolean;
    can_listing: boolean;
    can_earnings: boolean;
}

const ownerAccess = (providerId: string): ProviderAccess => ({
    providerId,
    accessId: null,
    isOwner: true,
    role: 'owner',
    can_calendar: true,
    can_messages: true,
    can_bookings: true,
    can_listing: true,
    can_earnings: true,
});

const fromRow = (providerId: string, a: any): ProviderAccess => ({
    providerId,
    accessId: a.id,
    isOwner: false,
    role: 'co_host',
    can_calendar: !!a.can_calendar,
    can_messages: !!a.can_messages,
    can_bookings: !!a.can_bookings,
    can_listing: !!a.can_listing,
    can_earnings: !!a.can_earnings,
});

// Every business this person can act on, and what they may do with each. Owned
// ones first, so a person who runs their own business and helps with someone
// else's lands on their own.
export async function accessibleProviders(userId: string): Promise<ProviderAccess[]> {
    if (!userId) return [];
    const admin = adminClient();
    const out: ProviderAccess[] = [];

    const { data: owned } = await admin.from('service_providers').select('id').eq('owner_id', userId);
    (owned || []).forEach((p: any) => out.push(ownerAccess(p.id)));

    const { data: granted } = await admin
        .from('provider_access')
        .select('id, provider_id, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('user_id', userId)
        .eq('status', 'active');
    (granted || []).forEach((a: any) => {
        if (out.some((o) => o.providerId === a.provider_id)) return;
        out.push(fromRow(a.provider_id, a));
    });
    return out;
}

// The provider ids this person may use for a given purpose.
export async function providerIdsFor(userId: string, permission: ProviderPermission): Promise<string[]> {
    const all = await accessibleProviders(userId);
    return all.filter((a) => a[permission]).map((a) => a.providerId);
}

// The raw lookup: the owner, or any active co-host grant, or null.
export async function providerAccessFor(userId: string, providerId: string): Promise<ProviderAccess | null> {
    if (!userId || !providerId) return null;
    const admin = adminClient();
    const { data: p } = await admin.from('service_providers').select('id, owner_id').eq('id', providerId).maybeSingle();
    if (!p) return null;
    if (p.owner_id === userId) return ownerAccess(providerId);
    const { data: a } = await admin
        .from('provider_access')
        .select('id, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('provider_id', providerId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
    return a ? fromRow(providerId, a) : null;
}

// One business, one purpose. Null when they may not.
export async function checkProvider(
    userId: string,
    providerId: string,
    permission: ProviderPermission
): Promise<ProviderAccess | null> {
    const a = await providerAccessFor(userId, providerId);
    return a && a[permission] ? a : null;
}

export function isFullProviderAccess(a: ProviderAccess): boolean {
    return a.isOwner || (a.can_calendar && a.can_messages && a.can_bookings && a.can_listing && a.can_earnings);
}

// Owner-equivalent: the owner, or a full-access co-host. For what a full-access
// co-host shares with the owner (managing co-hosts, pausing the listing).
export async function ownerOrFullProviderAccess(userId: string, providerId: string): Promise<ProviderAccess | null> {
    const a = await providerAccessFor(userId, providerId);
    return a && isFullProviderAccess(a) ? a : null;
}

// Ownership, for what the owner never hands over: payouts (Stripe Connect), the
// subscription and trade billing, closing the account and the primary seat.
export async function ownsProvider(userId: string, providerId: string): Promise<boolean> {
    if (!userId || !providerId) return false;
    const admin = adminClient();
    const { data } = await admin.from('service_providers').select('owner_id').eq('id', providerId).maybeSingle();
    return !!data && data.owner_id === userId;
}

// THE BUSINESS A DASHBOARD PAGE SHOWS.
//
// The provider dashboard pages each used to load `owner_id = me`. They now load
// the businesses this person may use for the page's permission — owned first —
// and keep the old pick (an approved one, else the newest). A co-host with no
// business of their own lands on the one they help with.
export async function dashboardProviders(admin: any, userId: string, permission: ProviderPermission | null, columns: string): Promise<{ rows: any[]; access: Record<string, ProviderAccess> }> {
    const all = await accessibleProviders(userId);
    const usable = permission ? all.filter((a) => a[permission]) : all;
    if (usable.length === 0) return { rows: [], access: {} };
    const ids = usable.map((a) => a.providerId);
    const { data } = await admin
        .from('service_providers')
        .select(columns)
        .in('id', ids)
        .order('updated_at', { ascending: false });
    const access: Record<string, ProviderAccess> = {};
    usable.forEach((a) => { access[a.providerId] = a; });
    // Owned rows ahead of co-hosted ones; within each, the query's order.
    const rows = (data || []).slice().sort((x: any, y: any) => Number(!access[x.id].isOwner) - Number(!access[y.id].isOwner));
    return { rows, access };
}

// WHO HEARS ABOUT IT.
//
// The owner and every active co-host whose permissions cover the event. Emails
// and pushes for a business go to each of them, exactly as the owner gets them —
// a co-host with messages hears about a new message, one with bookings about a
// new booking. Returns user ids with their sign-in addresses.
export async function providerTeam(admin: any, providerId: string, permission: ProviderPermission): Promise<{ userId: string; email: string; isOwner: boolean }[]> {
    if (!providerId) return [];
    const { data: p } = await admin.from('service_providers').select('owner_id').eq('id', providerId).maybeSingle();
    const { data: rows } = await admin
        .from('provider_access')
        .select('user_id, email, ' + permission)
        .eq('provider_id', providerId)
        .eq('status', 'active');
    const out: { userId: string; email: string; isOwner: boolean }[] = [];
    if (p && p.owner_id) {
        const { data: u } = await admin.auth.admin.getUserById(p.owner_id);
        out.push({ userId: p.owner_id, email: (u && u.user && u.user.email) || '', isOwner: true });
    }
    for (const r of rows || []) {
        if (!r.user_id || !r[permission] || out.some((o) => o.userId === r.user_id)) continue;
        out.push({ userId: r.user_id, email: String(r.email || ''), isOwner: false });
    }
    return out;
}

// The co-hosts only (not the owner) — for fanning out an email the owner already
// receives through its existing path.
export async function providerCohostEmails(admin: any, providerId: string, permission: ProviderPermission): Promise<string[]> {
    if (!providerId) return [];
    const { data } = await admin
        .from('provider_access')
        .select('email, user_id')
        .eq('provider_id', providerId)
        .eq('status', 'active')
        .eq(permission, true);
    return (data || []).filter((r: any) => r.user_id && r.email).map((r: any) => String(r.email));
}

// The one row a single-business dashboard page shows: their own business when
// they have one (the approved one, else the newest), otherwise the one they
// co-host (approved first). The old `list.find(approved) || list[0]`, owned first.
//
// `preferredId` is the business they last switched to (the gg_business cookie,
// components/services/BusinessSwitcher) — honoured when they may use it here.
export const BUSINESS_COOKIE = 'gg_business';

export function pickDashboardProvider<T extends { id: string; status?: string | null }>(rows: T[], access: Record<string, ProviderAccess>, preferredId?: string | null): T | null {
    const preferred = preferredId ? rows.find((r) => r.id === preferredId) : null;
    if (preferred) return preferred;
    const owned = rows.filter((r) => access[r.id] && access[r.id].isOwner);
    const pool = owned.length ? owned : rows;
    return pool.find((p) => p.status === 'approved') || pool[0] || null;
}

// For a co-host who lacks the page's permission: the first dashboard page they
// may open, so a calendar-only co-host isn't told they have no business.
export async function firstProviderPageFor(userId: string): Promise<string | null> {
    const all = await accessibleProviders(userId);
    if (all.length === 0) return null;
    const has = (k: ProviderPermission) => all.some((a) => a[k]);
    if (has('can_bookings')) return '/services/dashboard';
    if (has('can_calendar')) return '/services/dashboard/calendar';
    if (has('can_listing')) return '/services/dashboard/edit';
    if (has('can_messages')) return '/messages';
    if (has('can_earnings')) return '/services/dashboard/earnings';
    return null;
}

// The route-side gate, for a provider row already loaded with its owner_id:
// the owner, or a co-host with the permission ('full' = owner or full access).
// Replaces the `provider.owner_id === user.id` checks one for one.
export async function mayActOn(
    admin: any,
    userId: string | null | undefined,
    provider: { id: string; owner_id?: string | null } | null | undefined,
    permission: ProviderPermission | 'full'
): Promise<boolean> {
    if (!userId || !provider || !provider.id) return false;
    if (provider.owner_id && provider.owner_id === userId) return true;
    const { data: a } = await admin
        .from('provider_access')
        .select('can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq('provider_id', provider.id)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
    if (!a) return false;
    if (permission === 'full') return !!(a.can_calendar && a.can_messages && a.can_bookings && a.can_listing && a.can_earnings);
    return a[permission] === true;
}

// The same two questions with a caller's client, for the libraries that are
// handed one (thread helpers, badge counts) rather than reaching for their own.
export async function cohostCan(admin: any, providerId: string, userId: string, permission: ProviderPermission): Promise<boolean> {
    if (!providerId || !userId) return false;
    const { data } = await admin
        .from('provider_access')
        .select('id')
        .eq('provider_id', providerId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .eq(permission, true)
        .maybeSingle();
    return !!data;
}

export async function providerIdsWith(admin: any, userId: string, permission: ProviderPermission): Promise<string[]> {
    if (!userId) return [];
    const [{ data: owned }, { data: granted }] = await Promise.all([
        admin.from('service_providers').select('id').eq('owner_id', userId),
        admin.from('provider_access').select('provider_id').eq('user_id', userId).eq('status', 'active').eq(permission, true),
    ]);
    return Array.from(new Set([
        ...(owned || []).map((p: any) => p.id),
        ...(granted || []).map((g: any) => g.provider_id),
    ]));
}

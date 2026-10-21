import { APPROVED_LISTING_STATUSES, HostPerms, NO_WORK_SIDE, WorkSide } from './workMode';

// Reads what a signed-in person can work as, with their own (RLS-bound)
// client: an owner can read their own listings and their own provider row
// whatever its state, and the "people see their own access" policy lets a
// co-host read their own listing_access rows. Derived from the rows rather than
// a stored flag, so it can never fall out of step with reality.
//
// A co-host is a host too. Someone invited onto another owner's listing, whose
// invitation they have accepted, gets "Switch to hosting" and the host
// dashboard exactly as an owner does — the same way Airbnb treats a co-host.
// Before this, `isHost` counted only listings they owned (host_id), so a pure
// co-host was shown the guest menu and could not reach a single host page,
// though every host page and route would have granted them what they were
// given. `ownsAny` and `hostPerms` carry the rest of what the menu needs: which
// sections to show, and whether they own a listing at all (owner-only sections).
export async function readWorkSide(
    supabase: any,
    userId: string | null | undefined
): Promise<WorkSide & { providerAudience: string | null; ownsAny: boolean; isFullAccessSomewhere: boolean; hostPerms: HostPerms; providerPerms: HostPerms; providerFullAccess: boolean }> {
    if (!userId) {
        return {
            ...NO_WORK_SIDE,
            providerAudience: null,
            ownsAny: false,
            isFullAccessSomewhere: false,
            hostPerms: { can_calendar: false, can_messages: false, can_bookings: false, can_listing: false, can_earnings: false },
            providerPerms: { can_calendar: false, can_messages: false, can_bookings: false, can_listing: false, can_earnings: false },
            providerFullAccess: false,
        };
    }

    const [anyListing, approvedListing, coHost, provider, providerCoHost] = await Promise.all([
        // Drafts count for the switch: you're mid-way through becoming a host.
        supabase.from('listings').select('id', { count: 'exact', head: true }).eq('host_id', userId),
        supabase
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('host_id', userId)
            .in('status', APPROVED_LISTING_STATUSES),
        // The listings they co-host, and what each owner let them do. Only an
        // accepted (active) co_host grant counts: an unaccepted invitation or a
        // revoked one is not hosting, and staff — who see arrival and departure
        // dates and nothing else — are not given the host side.
        supabase
            .from('listing_access')
            .select('can_calendar, can_messages, can_bookings, can_listing, can_earnings')
            .eq('user_id', userId)
            .eq('status', 'active')
            .eq('role', 'co_host'),
        // Every business they own, whatever its state — a draft, one in review,
        // one sent back, or a live one. Like a host with a listing in review,
        // someone who has applied works from their own side from then on: the
        // switch and "Your listing", never "Start hosting" again (which only
        // starts a second application). Until it is live, the menu offers just
        // the listing and messages (see notLive below). The audience lets the
        // menu show an experience provider their own sections.
        supabase
            .from('service_providers')
            .select('audience, status')
            .eq('owner_id', userId)
            .order('updated_at', { ascending: false })
            .limit(10),
        // The businesses they co-host (provider_access — the same system, on a
        // trade or an experience), and what each owner let them do. Their own
        // rows only ("people see their own provider access").
        supabase
            .from('provider_access')
            .select('provider_id, can_calendar, can_messages, can_bookings, can_listing, can_earnings')
            .eq('user_id', userId)
            .eq('status', 'active'),
    ]);

    // A business co-host is a provider too — of a live business. Its audience
    // (experience or trade) picks the menu, as an owner's does.
    const providerGrants: any[] = (providerCoHost && providerCoHost.data) || [];
    // Their own business: the live one when they have one, else the newest —
    // the same pick as the dashboard (lib/providerAccess pickDashboardProvider).
    const ownedRows: { audience: string | null; status: string | null }[] = (provider && provider.data) || [];
    const isLive = (r: { status: string | null }) => r.status === 'approved' || r.status === 'hidden';
    const owned = ownedRows.find(isLive) || ownedRows[0] || null;
    // A TRADE that has applied but is not live yet: its requests, calendar and
    // earnings pages are for a live business and bounce to the wizard, so the
    // menu offers only the listing and messages. A GUEST EXPERIENCE gets its whole
    // menu from the moment it applies, as a host with a listing in review does
    // (Liam, 21 Oct 2026): reservations, calendar, reviews, earnings and co-hosts
    // all open before approval — empty until guests can book — so it is never
    // restricted here.
    const notLive = !!owned && !isLive(owned) && owned.audience !== 'guest';

    let coProvider: { audience: string } | null = null;
    if (!owned && providerGrants.length > 0) {
        const { data } = await supabase
            .from('service_providers')
            .select('audience')
            .in('id', providerGrants.map((g) => g.provider_id))
            .eq('status', 'approved')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        coProvider = data || null;
    }
    const ownsProvider = !!owned;
    const ownerCan = (key: keyof HostPerms) => ownsProvider && (!notLive || key === 'can_listing' || key === 'can_messages');
    const pcan = (key: keyof HostPerms) => ownerCan(key) || providerGrants.some((r) => r[key] === true);
    const providerPerms: HostPerms = {
        can_calendar: pcan('can_calendar'),
        can_messages: pcan('can_messages'),
        can_bookings: pcan('can_bookings'),
        can_listing: pcan('can_listing'),
        can_earnings: pcan('can_earnings'),
    };
    const providerFullAccess = (ownsProvider && !notLive) || providerGrants.some(
        (r) => r.can_calendar && r.can_messages && r.can_bookings && r.can_listing && r.can_earnings
    );

    const ownsAny = (anyListing.count || 0) > 0;
    const coHostRows: any[] = coHost.data || [];
    const coHosts = coHostRows.length > 0;

    // An owner may do everything on their own listing; otherwise it is the OR of
    // their co-host grants, so a section shows if they have it on any property.
    const can = (key: keyof HostPerms) => ownsAny || coHostRows.some((r) => r[key] === true);
    const hostPerms: HostPerms = {
        can_calendar: can('can_calendar'),
        can_messages: can('can_messages'),
        can_bookings: can('can_bookings'),
        can_listing: can('can_listing'),
        can_earnings: can('can_earnings'),
    };

    // A co-host the owner ticked every permission for is the owner's equal (see
    // lib/access isFullAccess), so they get the owner-only menu sections — the
    // Co-hosts page above all. An owner is trivially full access.
    const isFullAccessSomewhere =
        ownsAny ||
        coHostRows.some(
            (r) => r.can_calendar && r.can_messages && r.can_bookings && r.can_listing && r.can_earnings
        );

    return {
        // Owns a listing (drafts included) or co-hosts one: shown the switch.
        isHost: ownsAny || coHosts,
        // Approved to work on the host side, which decides only the default side
        // for someone who has never used the switch. A co-host's grant is an
        // owner-approved relationship, so they default onto hosting, as on Airbnb.
        isApprovedHost: (approvedListing.count || 0) > 0 || coHosts,
        isProvider: ownsProvider || !!coProvider,
        providerAudience: (owned && owned.audience) || (coProvider && coProvider.audience) || null,
        providerPerms,
        providerFullAccess,
        ownsAny,
        isFullAccessSomewhere,
        hostPerms,
    };
}

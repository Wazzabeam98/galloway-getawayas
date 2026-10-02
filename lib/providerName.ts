// The provider's FIRST NAME, for guest-facing copy that addresses the person
// rather than the listing — "Your booking with Fiona", not "…with Sunrise wild
// swim". Guest experiences are individual people shown by first name only (the
// same rule the marketplace byline follows), so an order email names the person.
//
// Server-only: it is handed an admin (service-role) client and reads the owner's
// profile live — a name is not frozen onto the order the way a price is, and the
// first-name/preferred-name/show-full-name switch must be honoured at send time.
// A surname never reaches a guest: firstName() takes only the first token. Falls
// back to the caller's string (usually the frozen provider_business_name) when
// there is no shown name, so an email never renders a blank.

import { firstName } from '@/lib/utils';

export async function providerFirstName(admin: any, providerId: string, fallback: string): Promise<string> {
    try {
        const { data: prov } = await admin
            .from('service_providers').select('owner_id').eq('id', providerId).maybeSingle();
        const ownerId = prov && prov.owner_id;
        if (!ownerId) return fallback;
        const { data: pr } = await admin
            .from('profiles').select('full_name, preferred_name, show_full_name').eq('id', ownerId).maybeSingle();
        return firstName(pr || null, '') || fallback;
    } catch {
        return fallback;
    }
}

// The first names for several providers at once, keyed by provider id — for a
// batch surface (the needs-reply digest) that would otherwise fire two queries
// per order. Missing/blank names simply don't appear in the map; the caller
// falls back per id.
export async function providerFirstNames(admin: any, providerIds: string[]): Promise<Record<string, string>> {
    const ids = Array.from(new Set((providerIds || []).filter(Boolean)));
    if (!ids.length) return {};
    try {
        const { data: provs } = await admin
            .from('service_providers').select('id, owner_id').in('id', ids);
        const ownerByProvider: Record<string, string> = {};
        const ownerIds: string[] = [];
        for (const p of provs || []) {
            if (p.owner_id) { ownerByProvider[p.id] = p.owner_id; ownerIds.push(p.owner_id); }
        }
        if (!ownerIds.length) return {};
        const { data: profiles } = await admin
            .from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', Array.from(new Set(ownerIds)));
        const profileById: Record<string, any> = {};
        for (const pr of profiles || []) profileById[pr.id] = pr;
        const out: Record<string, string> = {};
        for (const pid of ids) {
            const name = firstName(profileById[ownerByProvider[pid]] || null, '');
            if (name) out[pid] = name;
        }
        return out;
    } catch {
        return {};
    }
}

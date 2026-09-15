// Reviews for a guest experience, read for the listing page.
//
// The cottage side stores rating aggregates on the listings row and keeps them
// in step with a trigger. service_providers deliberately keeps no counters — a
// stored count is one missed write from being wrong — so this computes the
// count and average on read, the same way the marketplace computes bookingsCount.
//
// The number a listing SHOWS follows the cottage rule (lib/reviews): a handful
// of reviews is not a rating, so the average is withheld until MIN_PUBLIC_REVIEWS
// of them exist. Below that the individual reviews still show — words, not a
// score. At zero this returns null and the section does not render at all.
//
// First name only, both for the guest who wrote it and the provider who replies.

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPublicScore, meanTo2dp } from '@/lib/reviews';
import { firstName } from '@/lib/utils';

export interface ExperienceReviewItem {
    id: string;
    rating: number;
    comment: string;
    reply: string | null;
    firstName: string;
    itemName: string | null;
    when: string;
}

export interface ExperienceReviewsBlock {
    count: number;
    // The average to show, or null while the listing has too few to publish one.
    avg: number | null;
    items: ExperienceReviewItem[];
    // Whether the current viewer is the provider, and so may reply.
    canReply: boolean;
    providerFirstName: string;
}

// Returns null when there is nothing to show (no published, un-hidden reviews),
// so the caller renders no section and the Verified badge carries the listing.
export async function loadExperienceReviews(
    admin: SupabaseClient,
    providerId: string,
    viewerId: string | null,
): Promise<ExperienceReviewsBlock | null> {
    const { data: rows } = await admin
        .from('reviews')
        .select('id, reviewer_id, rating, comment, host_reply, created_at, order_id')
        .eq('provider_id', providerId)
        .eq('review_type', 'guest_to_provider')
        .eq('is_published', true)
        .is('hidden_at', null)
        .order('created_at', { ascending: false });

    if (!rows || rows.length === 0) return null;

    const { data: prov } = await admin
        .from('service_providers')
        .select('owner_id')
        .eq('id', providerId)
        .maybeSingle();
    const ownerId: string | null = prov?.owner_id ?? null;

    const reviewerIds = Array.from(new Set(rows.map((r) => r.reviewer_id)));
    const { data: profs } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name')
        .in('id', reviewerIds);
    const nameById = new Map<string, string>();
    (profs || []).forEach((p) => nameById.set(p.id, firstName(p, 'Guest')));

    const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean)));
    const itemById = new Map<string, string | null>();
    if (orderIds.length) {
        const { data: orders } = await admin
            .from('service_orders')
            .select('id, item_name')
            .in('id', orderIds);
        (orders || []).forEach((o) => itemById.set(o.id, o.item_name ?? null));
    }

    let providerFirstName = 'the provider';
    if (ownerId) {
        const { data: op } = await admin
            .from('profiles')
            .select('full_name, preferred_name, show_full_name')
            .eq('id', ownerId)
            .maybeSingle();
        providerFirstName = firstName(op, 'the provider');
    }

    const ratings = rows.map((r) => Number(r.rating));
    const count = rows.length;

    return {
        count,
        avg: hasPublicScore(count) ? meanTo2dp(ratings) : null,
        canReply: !!viewerId && !!ownerId && viewerId === ownerId,
        providerFirstName,
        items: rows.map((r) => ({
            id: r.id,
            rating: Number(r.rating),
            comment: r.comment,
            reply: r.host_reply ?? null,
            firstName: nameById.get(r.reviewer_id) || 'Guest',
            itemName: (r.order_id && itemById.get(r.order_id)) || null,
            when: r.created_at,
        })),
    };
}

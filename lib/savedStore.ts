'use client';

// The guest's wishlists and saved items, on the client. A module-scope store
// (the useBadgeCounts pattern) so a grid of twenty hearts shares ONE fetch, not
// twenty, and every heart and the Save sheet stay in sync after a save.
//
// Everything here goes through the ORDINARY browser Supabase client under row-
// level security: wishlists/wishlist_items are the caller's own rows
// (guest_id = auth.uid()), and listings/service_providers are publicly readable,
// so covers resolve client-side too. Nothing is read on the server, so a cached
// public page can never carry one person's hearts.

import { useSyncExternalStore, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getImageUrl } from '@/lib/utils';

export type SavedKind = 'stay' | 'experience';

export function keyFor(kind: SavedKind, id: string): string {
    return (kind === 'stay' ? 'stay:' : 'exp:') + id;
}

export interface SavedCard {
    kind: SavedKind;
    id: string;
    title: string;
    subtitle: string;
    photo: string | null;
    href: string;
}

export interface WishlistSummary {
    id: string;
    name: string;
    count: number;
    cover: string | null;
}

export interface SavedState {
    loaded: boolean;
    signedIn: boolean;
    savedKeys: Set<string>;
    wishlists: WishlistSummary[];
    cards: Record<string, SavedCard[]>; // wishlistId -> its saved cards
}

let state: SavedState = { loaded: false, signedIn: false, savedKeys: new Set(), wishlists: [], cards: {} };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function notify() { listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }
export function getState(): SavedState { return state; }
export function subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

function photoFromListing(l: any): string | null {
    const key = l && Array.isArray(l.images) ? l.images[0] : null;
    return key ? getImageUrl(key) : null;
}
function photoFromProvider(p: any): string | null {
    const key = p && Array.isArray(p.photos) ? p.photos[0] : (p && p.headshot) || null;
    return key ? getImageUrl(key) : null;
}
function townOf(location: string | null): string {
    if (!location) return 'Dumfries & Galloway';
    // The town is usually the part before the postcode/county at the end.
    const parts = String(location).split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || 'Dumfries & Galloway';
}

async function fetchAll(): Promise<void> {
    try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData && userData.user && userData.user.id;
        if (!uid) {
            state = { loaded: true, signedIn: false, savedKeys: new Set(), wishlists: [], cards: {} };
            notify();
            return;
        }

        const [{ data: lists }, { data: items }] = await Promise.all([
            supabase.from('wishlists').select('id, name, created_at').order('created_at', { ascending: false }),
            supabase.from('wishlist_items').select('id, wishlist_id, listing_id, provider_id, created_at').order('created_at', { ascending: false }),
        ]);

        const rowItems = items || [];
        const listingIds = Array.from(new Set(rowItems.map((r: any) => r.listing_id).filter(Boolean)));
        const providerIds = Array.from(new Set(rowItems.map((r: any) => r.provider_id).filter(Boolean)));

        const [{ data: listings }, { data: providers }] = await Promise.all([
            listingIds.length
                ? supabase.from('listings').select('id, title, location, images, price_per_night, bedrooms, beds, bathrooms, property_type').in('id', listingIds)
                : Promise.resolve({ data: [] as any[] }),
            providerIds.length
                ? supabase.from('service_providers').select('id, business_name, based_line, photos, headshot').in('id', providerIds)
                : Promise.resolve({ data: [] as any[] }),
        ]);

        const listingById: Record<string, any> = {};
        (listings || []).forEach((l: any) => { listingById[l.id] = l; });
        const providerById: Record<string, any> = {};
        (providers || []).forEach((p: any) => { providerById[p.id] = p; });

        const cardFor = (r: any): SavedCard | null => {
            if (r.listing_id) {
                const l = listingById[r.listing_id];
                if (!l) return null;
                return {
                    kind: 'stay', id: r.listing_id, title: l.title || 'Holiday let',
                    subtitle: townOf(l.location), photo: photoFromListing(l), href: '/homes/' + r.listing_id,
                };
            }
            const p = providerById[r.provider_id];
            if (!p) return null;
            return {
                kind: 'experience', id: r.provider_id, title: p.business_name || 'Experience',
                subtitle: p.based_line || 'Experience', photo: photoFromProvider(p), href: '/experiences/browse/' + r.provider_id,
            };
        };

        const savedKeys = new Set<string>();
        const cards: Record<string, SavedCard[]> = {};
        rowItems.forEach((r: any) => {
            if (r.listing_id) savedKeys.add(keyFor('stay', r.listing_id));
            if (r.provider_id) savedKeys.add(keyFor('experience', r.provider_id));
            const card = cardFor(r);
            if (!card) return;
            (cards[r.wishlist_id] = cards[r.wishlist_id] || []).push(card);
        });

        const wishlists: WishlistSummary[] = (lists || []).map((w: any) => {
            const cs = cards[w.id] || [];
            return { id: w.id, name: w.name, count: cs.length, cover: (cs[0] && cs[0].photo) || null };
        });

        state = { loaded: true, signedIn: true, savedKeys, wishlists, cards };
        notify();
    } catch {
        state = { ...state, loaded: true };
        notify();
    }
}

// Load once; concurrent callers share the one fetch.
export function ensureLoaded(): Promise<void> {
    if (state.loaded) return Promise.resolve();
    if (!inFlight) inFlight = fetchAll().finally(() => { inFlight = null; });
    return inFlight;
}
export function reload(): Promise<void> {
    inFlight = fetchAll().finally(() => { inFlight = null; });
    return inFlight;
}

export function isSaved(kind: SavedKind, id: string): boolean {
    return state.savedKeys.has(keyFor(kind, id));
}

function targetCols(kind: SavedKind, id: string) {
    return kind === 'stay' ? { listing_id: id } : { provider_id: id };
}

export async function createWishlist(name: string): Promise<string | null> {
    const { data, error } = await supabase.from('wishlists').insert({ name: name || 'My wishlist' }).select('id').maybeSingle();
    await reload();
    return (!error && data && data.id) || null;
}

export async function addToWishlist(wishlistId: string, kind: SavedKind, id: string): Promise<void> {
    await supabase.from('wishlist_items').insert({ wishlist_id: wishlistId, ...targetCols(kind, id) });
    await reload();
}

// Unsave: remove this item from every wishlist it is in (the heart toggles off).
export async function removeSaved(kind: SavedKind, id: string): Promise<void> {
    const col = kind === 'stay' ? 'listing_id' : 'provider_id';
    await supabase.from('wishlist_items').delete().eq(col, id);
    await reload();
}

// Remove this item from ONE wishlist (toggling it off in the Save sheet).
export async function removeFromWishlist(wishlistId: string, kind: SavedKind, id: string): Promise<void> {
    const col = kind === 'stay' ? 'listing_id' : 'provider_id';
    await supabase.from('wishlist_items').delete().eq('wishlist_id', wishlistId).eq(col, id);
    await reload();
}

export function inWishlist(state: SavedState, wishlistId: string, kind: SavedKind, id: string): boolean {
    const cs = state.cards[wishlistId] || [];
    return cs.some((c) => c.kind === kind && c.id === id);
}

export async function renameWishlist(id: string, name: string): Promise<void> {
    await supabase.from('wishlists').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
    await reload();
}

export async function deleteWishlist(id: string): Promise<void> {
    await supabase.from('wishlists').delete().eq('id', id);
    await reload();
}

// React binding: subscribe to the store and trigger the one load on mount.
export function useSaved(): SavedState {
    useEffect(() => { ensureLoaded(); }, []);
    return useSyncExternalStore(subscribe, getState, getState);
}

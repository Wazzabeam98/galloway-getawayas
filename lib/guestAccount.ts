// Minting a guest account from checkout details, AFTER the money has confirmed.
//
// A brand-new guest can pay for an experience without signing up first: they
// type their name and email at checkout, and only once Stripe confirms the
// payment do we resolve-or-create their account and attach the order to it. A
// returning guest lands back on the ONE profile they already have, matched on
// their email — so the same address twice is one account, never two.
//
// This mirrors the account-minting primitive the provider onboarding flow uses
// (app/api/services/finish/route.ts: admin.auth.admin.createUser + a profiles
// upsert), but differs deliberately in three ways the guest case demands:
//
//   * PASSWORDLESS. The guest never chose a password; the account is created
//     confirmed and reached by magic link. finish/ sets a password because it
//     has one from its form.
//   * MATCH-AND-REUSE, not match-and-refuse. finish/ refuses a collision to
//     avoid a provider takeover; a returning guest is exactly a collision we
//     WANT to reuse, so repeat bookings stay on one profile.
//   * KEYED ON payment proof. Which email becomes the account is decided by the
//     Stripe-proven payer address, so a stranger's address typed into the form
//     can never graft an order onto their account (see resolveGuestForPaidOrder).
//
// The resolution rule is a pure function over a small store interface so it can
// be unit-tested without Stripe or a database; supabaseGuestStore() is the real
// implementation.

import { adminClient } from './supabaseAdmin';

// The public site origin. Mirrors lib/email.ts SITE_URL, defined locally so this
// module — imported by the unit tests — does not pull in the email module, whose
// own '@/…' imports Node cannot resolve at test runtime.
const SITE_ORIGIN = 'https://gallowaygetaways.co.uk';

/** Lowercase and trim an email for matching. Empty in, empty out. */
export function normaliseEmail(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

// The two capabilities the resolver needs, named so a test can fake them.
export interface GuestStore {
    /** The profile id registered to this (already-normalised) email, or null. */
    findIdByEmail(email: string): Promise<string | null>;
    /** Create a passwordless guest account + profile, returning its id. */
    createGuest(email: string, name: string | null, phone: string | null): Promise<string>;
}

export interface ResolvedGuest {
    id: string;
    /** True when a new account was minted, false when an existing one was reused. */
    created: boolean;
    /** The email the account is keyed on. */
    email: string;
}

// The identity rule, in one place, over the store above.
//
// typedEmail is what the guest entered in the checkout form; payerEmail is the
// address Stripe verified on the card/receipt. Only the payer address is proof
// of ownership, so:
//
//   1. If the PAYER already has an account, reuse it. This is the returning
//      guest paying with the same card — the repeat-booking case — and it is
//      proven, so it is safe to attach the new order to it.
//   2. Otherwise, if the TYPED email is free (no account), create the account on
//      it. That is the address the guest expects to sign in with, and there is
//      no one to hijack because nobody holds it.
//   3. Otherwise the typed email belongs to an account we have NOT proven is
//      theirs (they typed a stranger's address, or their own but paid from
//      another) — so never attach to it. Fall back to the proven payer address:
//      reuse it if it has an account, else create one on it.
//   4. With no payer address at all (which a completed Checkout should always
//      carry) fall back to the typed address as a last resort.
export async function resolveGuestForPaidOrder(
    store: GuestStore,
    input: { typedEmail?: string | null; payerEmail?: string | null; name?: string | null; phone?: string | null }
): Promise<ResolvedGuest> {
    const typed = normaliseEmail(input.typedEmail);
    const payer = normaliseEmail(input.payerEmail);
    const name = input.name ? String(input.name).trim() || null : null;
    const phone = input.phone ? String(input.phone).trim() || null : null;

    // 1. Reuse a proven (payer) account.
    if (payer) {
        const provenId = await store.findIdByEmail(payer);
        if (provenId) return { id: provenId, created: false, email: payer };
    }

    // 2. Typed email is free — create the account the guest will expect to use.
    if (typed) {
        const clashId = await store.findIdByEmail(typed);
        if (!clashId) {
            const id = await store.createGuest(typed, name, phone);
            return { id, created: true, email: typed };
        }
        // typed is taken by an account we have not proven — do NOT attach to it.
    }

    // 3. Fall back to the proven payer address (reuse handled in step 1, so here
    //    it has no account yet — create one on it).
    if (payer) {
        const id = await store.createGuest(payer, name, phone);
        return { id, created: true, email: payer };
    }

    // 4. No payer address at all — last resort on whatever was typed.
    if (typed) {
        const id = await store.createGuest(typed, name, phone);
        return { id, created: true, email: typed };
    }

    throw new Error('resolveGuestForPaidOrder: no email to resolve a guest from');
}

// The real store, over the service-role client. Kept out of the resolver so the
// rule above stays pure and testable.
export function supabaseGuestStore(admin: any = adminClient()): GuestStore {
    return {
        async findIdByEmail(email: string): Promise<string | null> {
            // ilike with no wildcards is a case-insensitive equality — the same
            // match the companion-invite flow uses on profiles.email.
            const { data } = await admin
                .from('profiles')
                .select('id')
                .ilike('email', email)
                .limit(1);
            return (data && data[0] && data[0].id) || null;
        },

        async createGuest(email: string, name: string | null, phone: string | null): Promise<string> {
            // Passwordless and confirmed: the guest reaches the account by the
            // magic link we email, never a password they never set.
            const { data: made, error } = await admin.auth.admin.createUser({
                email,
                email_confirm: true,
                user_metadata: name ? { name } : undefined,
            });

            if (error || !made || !made.user) {
                // A race (or a returning guest whose profile row is missing but
                // whose auth user exists) can surface as "already registered".
                // That is not a failure — find the account and reuse it.
                const message = String((error && error.message) || '');
                if (/already|registered|exists/i.test(message)) {
                    const existing = await this.findIdByEmail(email);
                    if (existing) return existing;
                }
                throw new Error('createGuest: ' + (message || 'could not create the account'));
            }

            const id = made.user.id;
            // full_name is the PERSON's name; is_host false. Phone is the guest's
            // own contact, useful for prefilling a repeat booking. Upsert on id so
            // a re-run (or an auth user that already had a profile) is idempotent.
            await admin.from('profiles').upsert(
                { id, email, full_name: name, phone, is_host: false },
                { onConflict: 'id' }
            );
            return id;
        },
    };
}

// A single-use magic link that drops the guest straight onto `next` already
// signed in — no password, no separate sign-in step. Built exactly as the seed
// tooling builds it: an admin generate_link for the address, then our own
// /auth/callback (which shows the GET interstitial and consumes on POST, so a
// mail scanner cannot burn the token). Returns null if the link cannot be
// minted; the caller falls back to a plain link that asks the guest to sign in.
export async function guestMagicLink(email: string, next: string): Promise<string | null> {
    try {
        const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!base || !key) return null;

        const res = await fetch(base + '/auth/v1/admin/generate_link', {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: 'Bearer ' + key,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type: 'magiclink', email }),
        });
        const link = await res.json().catch(() => null);
        if (!link || !link.hashed_token) return null;

        return SITE_ORIGIN
            + '/auth/callback?type=magiclink&next=' + encodeURIComponent(next)
            + '&token_hash=' + encodeURIComponent(String(link.hashed_token));
    } catch (err) {
        return null;
    }
}

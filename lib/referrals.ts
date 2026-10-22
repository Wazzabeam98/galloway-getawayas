import { randomBytes } from 'crypto';

// The referral scheme, server side. One file owns minting a person's link code,
// attaching a referral as it progresses, and stamping the reward due. It covers
// all three things a person can run on the platform:
//
//   type       what the referred person does        reward   waiver
//   stay       lists a holiday let                  £50      their 1st stay's commission
//   experience runs a guest experience              £25      their 1st booking's commission
//   trade      a host trade/service (plumber etc)   £15      none (6 months free is their offer)
//
// SERVER ONLY. It reads and writes the referral_codes / referrals tables, which
// are service-role only (no browser ever touches them), and it imports node
// crypto — so it must never be pulled into a client component. The admin client
// passed in is always the service-role client (lib/supabaseAdmin adminClient).
//
// THE STATE MACHINE (type-neutral).
//   invited     an account exists for the referred person; no qualifying action yet
//   active      they listed / created / registered their thing (type is set now)
//   reward_due  their first booking completed (stay/experience) or first month was
//               paid (trade); for stay/experience the commission was waived and the
//               reward is now owed
//   reward_paid the owner has paid the referrer by bank transfer
//
// The rules the scheme promises — first referral wins, no self-referral, only
// genuinely new hosts/providers — are enforced here and in the table (unique
// referred_user_id, CHECK referrer <> referred). See the migrations
// 20261022111408_host_referrals.sql and 20261022120720_referrals_three_types.sql.

export type ReferralType = 'stay' | 'experience' | 'trade';

// The reward per type, in pounds. Paid by bank transfer for now; the owner marks
// it paid at /admin/referrals.
export const REFERRAL_REWARDS: Record<ReferralType, number> = {
    stay: 50,
    experience: 25,
    trade: 15,
};

// The headline figure ("earn up to £50").
export const REFERRAL_REWARD_MAX = Math.max(...Object.values(REFERRAL_REWARDS));

// The cookie that carries the referral code from the /refer/<code> landing
// through sign-up to the moment the person acts. httpOnly so only the server
// reads it; 60 days is long enough to cover "I'll get round to it".
export const REFERRAL_COOKIE = 'gg_ref';
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days, in seconds

export type ReferralStatus = 'invited' | 'active' | 'reward_due' | 'reward_paid';

export interface ReferralRow {
    id: string;
    referrer_id: string;
    referred_user_id: string;
    type: ReferralType | null;
    status: ReferralStatus;
    reward_amount: number | null;
    waived_booking_id: string | null;
    waived_order_id: string | null;
    waived_commission: number | null;
    reward_due_at: string | null;
    reward_paid_at: string | null;
    created_at: string;
    updated_at: string;
}

// A short, human-shareable code — not a secret (it only ever names a referrer),
// so it is readable rather than hashed. No 0/O/1/I so it survives being read
// aloud or retyped off a message.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function newReferralCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
}

// The one code for a person, minted the first time they need it (their /refer
// page, or the nav). Idempotent: a second call returns the same code. A code
// collision — astronomically unlikely at 32^8 — is retried rather than handed
// back as somebody else's code.
export async function getOrCreateReferralCode(admin: any, userId: string): Promise<string | null> {
    if (!userId) return null;

    const { data: existing } = await admin
        .from('referral_codes')
        .select('code')
        .eq('user_id', userId)
        .maybeSingle();
    if (existing && existing.code) return existing.code;

    for (let attempt = 0; attempt < 5; attempt++) {
        const code = newReferralCode();
        const { data, error } = await admin
            .from('referral_codes')
            .insert({ user_id: userId, code })
            .select('code')
            .maybeSingle();

        if (!error && data && data.code) return data.code;

        // A row for this user arrived from a parallel request between the read
        // and the insert — use theirs rather than fight over it.
        const { data: now } = await admin
            .from('referral_codes')
            .select('code')
            .eq('user_id', userId)
            .maybeSingle();
        if (now && now.code) return now.code;
        // Otherwise the clash was on the code itself; loop and mint another.
    }
    return null;
}

export async function referrerForCode(admin: any, code: string): Promise<string | null> {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return null;
    const { data } = await admin
        .from('referral_codes')
        .select('user_id')
        .eq('code', clean)
        .maybeSingle();
    return (data && data.user_id) || null;
}

// "Only genuinely new hosts/providers." Someone already established in that role
// before they clicked is not who the scheme is for, so no referral is created or
// advanced for them. A draft or a first submission still in review does NOT count
// as established — that is exactly the person we want, at the moment they act.
//   stay       a listing that has been live (published, or host-hidden)
//   experience an APPROVED guest experience provider of their own
//   trade      an APPROVED host trade/service provider of their own
export async function isEstablished(admin: any, userId: string, type: ReferralType): Promise<boolean> {
    if (type === 'stay') {
        const { data } = await admin
            .from('listings')
            .select('id')
            .eq('host_id', userId)
            .in('status', ['published', 'hidden'])
            .limit(1);
        return !!(data && data.length);
    }
    const audience = type === 'experience' ? 'guest' : 'host';
    const { data } = await admin
        .from('service_providers')
        .select('id')
        .eq('owner_id', userId)
        .eq('audience', audience)
        .eq('status', 'approved')
        .limit(1);
    return !!(data && data.length);
}

export type AttachOutcome = 'invited' | 'active' | 'noop' | 'none';

// Record or advance a referral, idempotently. `stage` is the furthest point
// reached so far: 'invited' at sign-up (type unknown), 'active' when the person
// takes their first qualifying action (type known). Best-effort — a caller wraps
// it so a failure never breaks the sign-in / publish / submit that triggered it.
export async function attachReferral(
    admin: any,
    opts: {
        code: string | null | undefined;
        referredUserId: string;
        stage: 'invited' | 'active';
        type?: ReferralType;
    }
): Promise<AttachOutcome> {
    const { code, referredUserId, stage, type } = opts;
    if (!referredUserId) return 'none';
    if (stage === 'active' && !type) return 'none';

    const referrerId = await referrerForCode(admin, code || '');
    if (!referrerId) return 'none';
    if (referrerId === referredUserId) return 'none'; // no self-referral

    // Genuinely-new gate, only knowable once we have a type.
    if (stage === 'active' && type && (await isEstablished(admin, referredUserId, type))) {
        return 'none';
    }

    // First referral wins: a row for this person already exists, so no other
    // code may claim them. Advance invited → active (and set the type) once; an
    // already-active/rewarded row keeps the type of the first action taken.
    const { data: existing } = await admin
        .from('referrals')
        .select('id, status')
        .eq('referred_user_id', referredUserId)
        .maybeSingle();

    if (existing) {
        if (stage === 'active' && existing.status === 'invited') {
            await admin
                .from('referrals')
                .update({ status: 'active', type, updated_at: new Date().toISOString() })
                .eq('id', existing.id)
                .eq('status', 'invited');
            return 'active';
        }
        return 'noop';
    }

    const { error } = await admin.from('referrals').insert({
        referrer_id: referrerId,
        referred_user_id: referredUserId,
        status: stage,
        type: stage === 'active' ? type : null,
    });

    // A parallel attach won the unique referred_user_id — their row stands.
    if (error) return 'noop';
    return stage;
}

// Is there a reward waiting to be triggered for this person's first booking of
// the given type? A payout cron asks this per booking: a referral sitting at
// 'active' with a matching type means the next booking to pay out is the first,
// so its commission is waived.
export async function waivableReferralFor(admin: any, userId: string, type: ReferralType): Promise<ReferralRow | null> {
    if (!userId) return null;
    const { data } = await admin
        .from('referrals')
        .select('*')
        .eq('referred_user_id', userId)
        .eq('status', 'active')
        .eq('type', type)
        .maybeSingle();
    // Only a real single row waives money. maybeSingle returns an object or null
    // in production; anything else (an array, a stray truthy value) is treated
    // as "no referral" rather than risk waiving a commission on a malformed read
    // — this is the money path.
    return (data && typeof data === 'object' && !Array.isArray(data)) ? (data as ReferralRow) : null;
}

// Stamp the reward due, as a CLAIM: the conditional update only matches a row
// still at 'active' of the given type, so two overlapping runs (or a stay and an
// experience path) cannot both stamp it and both email the referrer. The reward
// amount follows from the type. Returns the updated row when THIS call made the
// transition (so the caller sends the email), or null when it did not.
export async function markReferralRewardDue(
    admin: any,
    opts: {
        referredUserId: string;
        type: ReferralType;
        waivedBookingId?: string | null;
        waivedOrderId?: string | null;
        waivedCommission?: number | null;
    }
): Promise<ReferralRow | null> {
    const { referredUserId, type, waivedBookingId, waivedOrderId, waivedCommission } = opts;
    const now = new Date().toISOString();

    const { data } = await admin
        .from('referrals')
        .update({
            status: 'reward_due',
            reward_amount: REFERRAL_REWARDS[type],
            waived_booking_id: waivedBookingId ?? null,
            waived_order_id: waivedOrderId ?? null,
            waived_commission: waivedCommission ?? null,
            reward_due_at: now,
            updated_at: now,
        })
        .eq('referred_user_id', referredUserId)
        .eq('status', 'active')
        .eq('type', type)
        .select('*')
        .maybeSingle();

    return (data && typeof data === 'object' && !Array.isArray(data)) ? (data as ReferralRow) : null;
}

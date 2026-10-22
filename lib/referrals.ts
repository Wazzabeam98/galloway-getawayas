import { randomBytes } from 'crypto';

// The host referral scheme, server side. One file owns minting a person's link
// code, attaching a referral as it progresses, and stamping the reward due.
//
// SERVER ONLY. It reads and writes the referral_codes / referrals tables, which
// are service-role only (no browser ever touches them), and it imports node
// crypto — so it must never be pulled into a client component. The admin client
// passed in is always the service-role client (lib/supabaseAdmin adminClient).
//
// THE STATE MACHINE.
//   invited          an account exists for the referred person, nothing listed
//   listed           they have submitted a listing of their own (first → review)
//   first_stay_done  their first stay has completed and paid out; that booking's
//                    commission was waived and the £50 reward is now due
//   reward_paid      the owner has paid the referrer by bank transfer
//
// The rules the scheme promises — first referral wins, no self-referral, only
// genuinely new hosts — are enforced here and in the table (unique
// referred_user_id, CHECK referrer <> referred). See the migration
// 20261022111408_host_referrals.sql.

// The referrer's reward, in pounds. Paid by bank transfer for now; the owner
// marks it paid at /admin/referrals.
export const REFERRAL_REWARD_GBP = 50;

// The cookie that carries the referral code from the /refer/<code> landing
// through sign-up to the moment the person lists. httpOnly so only the server
// reads it; 60 days is long enough to cover "I'll get round to listing".
export const REFERRAL_COOKIE = 'gg_ref';
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days, in seconds

export type ReferralStatus = 'invited' | 'listed' | 'first_stay_done' | 'reward_paid';

export interface ReferralRow {
    id: string;
    referrer_id: string;
    referred_user_id: string;
    status: ReferralStatus;
    reward_amount: number | null;
    waived_booking_id: string | null;
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

// "Only genuinely new hosts." Someone who already has a listing that has been
// live (published, or hidden by its host) was a host before they clicked, so no
// referral is created for them. A draft or a first listing still in review does
// NOT count as established — that is exactly the person the scheme is for, at
// the moment they list.
export async function isEstablishedHost(admin: any, userId: string): Promise<boolean> {
    const { data } = await admin
        .from('listings')
        .select('id')
        .eq('host_id', userId)
        .in('status', ['published', 'hidden'])
        .limit(1);
    return !!(data && data.length);
}

export type AttachOutcome = 'invited' | 'listed' | 'noop' | 'none';

// Record or advance a referral, idempotently. `stage` is the furthest point
// reached so far: 'invited' at sign-up, 'listed' when the person submits their
// first listing. Best-effort — a caller wraps it so a failure never breaks the
// sign-in or the publish that triggered it.
export async function attachReferral(
    admin: any,
    opts: { code: string | null | undefined; referredUserId: string; stage: 'invited' | 'listed' }
): Promise<AttachOutcome> {
    const { code, referredUserId, stage } = opts;
    if (!referredUserId) return 'none';

    const referrerId = await referrerForCode(admin, code || '');
    if (!referrerId) return 'none';
    if (referrerId === referredUserId) return 'none'; // no self-referral

    // First referral wins: a row for this person already exists, so no other
    // code may claim them. Only advance invited → listed.
    const { data: existing } = await admin
        .from('referrals')
        .select('id, status')
        .eq('referred_user_id', referredUserId)
        .maybeSingle();

    if (existing) {
        if (stage === 'listed' && existing.status === 'invited') {
            await admin
                .from('referrals')
                .update({ status: 'listed', updated_at: new Date().toISOString() })
                .eq('id', existing.id)
                .eq('status', 'invited');
            return 'listed';
        }
        return 'noop';
    }

    // No row yet — only for a genuinely new host.
    if (await isEstablishedHost(admin, referredUserId)) return 'none';

    const { error } = await admin.from('referrals').insert({
        referrer_id: referrerId,
        referred_user_id: referredUserId,
        status: stage,
    });

    // A parallel attach won the unique referred_user_id — their row stands.
    if (error) return 'noop';
    return stage;
}

// Is there a reward waiting to be triggered for this host's first stay? The
// host-payouts cron asks this per booking: a referral sitting at 'listed' means
// the next stay to pay out is the first, so its commission is waived.
export async function waivableReferralFor(admin: any, hostId: string): Promise<ReferralRow | null> {
    if (!hostId) return null;
    const { data } = await admin
        .from('referrals')
        .select('*')
        .eq('referred_user_id', hostId)
        .eq('status', 'listed')
        .maybeSingle();
    // Only a real single row waives money. maybeSingle returns an object or
    // null in production; anything else (an array, a stray truthy value) is
    // treated as "no referral" rather than risk waiving a commission on a
    // malformed read — this is the money path.
    return (data && typeof data === 'object' && !Array.isArray(data)) ? (data as ReferralRow) : null;
}

// Stamp the reward due, as a CLAIM: the conditional update only matches a row
// still at 'listed', so two overlapping payout runs cannot both stamp it and
// both email the referrer. Returns the updated row when THIS call made the
// transition (so the caller sends the email), or null when it did not.
export async function markReferralRewardDue(
    admin: any,
    opts: { referredUserId: string; bookingId: string; waivedCommission: number }
): Promise<ReferralRow | null> {
    const { referredUserId, bookingId, waivedCommission } = opts;
    const now = new Date().toISOString();

    const { data } = await admin
        .from('referrals')
        .update({
            status: 'first_stay_done',
            reward_amount: REFERRAL_REWARD_GBP,
            waived_booking_id: bookingId,
            waived_commission: waivedCommission,
            reward_due_at: now,
            updated_at: now,
        })
        .eq('referred_user_id', referredUserId)
        .eq('status', 'listed')
        .select('*')
        .maybeSingle();

    return (data as ReferralRow) || null;
}

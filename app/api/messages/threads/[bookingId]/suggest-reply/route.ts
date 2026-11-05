import Anthropic from '@anthropic-ai/sdk';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { withinLimits } from '@/lib/rateLimit';
import { logError } from '@/lib/logError';
import { firstName, formatTime, hostByline } from '@/lib/utils';
import { revealSecret } from '@/lib/listingSecrets';
import { renderSecretTokens } from '@/lib/messageSecrets';
import { messagePreview } from '@/lib/messagePhotos';
import { normaliseReleaseSetting, DEFAULT_CODE_RELEASE_HOURS, arrivalSecretsReleaseAt } from '@/lib/bookingWindows';
import { cancellationWords } from '@/lib/bookingDisplay';
import { cancellationPosition } from '@/lib/cancellationView';
import { londonDayKey } from '@/lib/dayKey';
import {
    REPLY_MODEL, REPLY_SYSTEM, REPLY_SCHEMA, HOURLY_LIMIT, DAILY_LIMIT, MESSAGES_READ,
    costUsd, shareRules, replyPrompt, parseDraft, standInDraft, proseDate, type ReplyInput,
} from '@/lib/replySuggest';
import { aiReplySuggestionsOn, hasApiKey, spentThisMonth, capUsd, alertIfNeeded, logUsage } from '@/lib/aiReplyServer';

export const dynamic = 'force-dynamic';

// "Suggest reply" for a host on a guest's booking thread. Returns a DRAFT for
// the message box — it never sends anything, and nothing calls it but the host
// pressing the button.
//
// Who: the host, or a co-host with messages on the listing (the people who
// answer this thread). Never the guest or a companion.
// Guarded by: the AI_REPLY_SUGGESTIONS switch (lib/aiReplyServer), a per-host
// rate limit, and a monthly spend cap that alerts the directors at 80% and 100%.
// What the model sees is decided by lib/replySuggest: private details only when
// the guest may already see them. The API key never leaves the server.
export async function POST(_request: Request, { params }: { params: { bookingId: string } }) {
    const admin = adminClient();
    try {
        if (!aiReplySuggestionsOn()) return NextResponse.json({ ok: false, error: 'Not available.' }, { status: 404 });

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        const uid = user.id;

        const { data: booking } = await admin
            .from('bookings')
            .select('id, listing_id, guest_id, host_id, check_in, check_out, status, payment_status, guests, adults, children, pets, amount_paid, total_price, amount_refunded, balance_amount, balance_due_date, cleaning_fee, cancellation_policy, cancellation_custom_days, non_refundable')
            .eq('id', params.bookingId)
            .maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
        const onHostSide = booking.host_id === uid || !!(await checkListing(uid, booking.listing_id, 'can_messages'));
        if (!onHostSide) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

        const live = hasApiKey();
        // Production has no stand-in: no key there means not set up.
        if (!live && process.env.VERCEL_ENV === 'production') {
            return NextResponse.json({ ok: false, error: 'Suggestions aren’t set up yet.' }, { status: 503 });
        }

        // The cap before the limit: a paused month must not use up a host's quota.
        const cap = capUsd();
        const spent = await spentThisMonth(admin);
        if (live && spent >= cap) {
            await alertIfNeeded(admin, spent, cap);
            return NextResponse.json({ ok: false, error: 'Suggestions are paused for this month.' }, { status: 429 });
        }

        const verdict = await withinLimits([
            { bucket: 'ai-reply:host-hour', key: uid, max: HOURLY_LIMIT, windowMinutes: 60 },
            { bucket: 'ai-reply:host-day', key: uid, max: DAILY_LIMIT, windowMinutes: 60 * 24 },
        ], new Date(), admin);
        if (!verdict.ok) {
            return NextResponse.json({ ok: false, error: 'You’ve asked for a lot of suggestions — try again a little later.' }, { status: 429 });
        }

        // --- What the draft may be told -----------------------------------
        const { data: listing } = await admin
            .from('listings')
            .select('title, description, location, property_type, max_guests, bedrooms, beds, bathrooms, amenities, check_in_time, check_in_end_time, check_out_time, check_in_method, events_allowed, smoking_allowed, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, additional_rules, max_pets, pet_fee, checkout_tasks, checkout_note, neighbourhood, nearby, sleeping_arrangements, guest_safety, pool_access, street_address, postcode, host_id')
            .eq('id', booking.listing_id)
            .maybeSingle();

        const { data: releaseRow } = await admin
            .from('listing_access_codes').select('release_hours, release_at_time').eq('listing_id', booking.listing_id).maybeSingle();
        const release = releaseRow
            ? normaliseReleaseSetting((releaseRow as any).release_hours, (releaseRow as any).release_at_time)
            : normaliseReleaseSetting(DEFAULT_CODE_RELEASE_HOURS, null);
        const rules = shareRules(booking, new Date(), release, listing && listing.check_in_time);

        let arrival: any = null;
        let doorCode: string | null = null;
        let wifiPassword: string | null = null;
        if (rules.address || rules.secrets) {
            const { data: arr } = await admin.from('listing_arrival').select('arrival_directions, what3words, wifi_name, wifi_password').eq('listing_id', booking.listing_id).maybeSingle();
            arrival = arr;
        }
        if (rules.secrets) {
            const [{ data: code }, { data: override }] = await Promise.all([
                admin.from('listing_access_codes').select('code').eq('listing_id', booking.listing_id).maybeSingle(),
                admin.from('booking_access_codes').select('code').eq('booking_id', booking.id).maybeSingle(),
            ]);
            const where = 'messages/suggest-reply';
            doorCode = (override && await revealSecret(override.code, { table: 'booking_access_codes', id: booking.id }, where))
                || (code && await revealSecret(code.code, { table: 'listing_access_codes', id: booking.listing_id }, where)) || null;
            wifiPassword = (arrival && arrival.wifi_password && await revealSecret(arrival.wifi_password, { table: 'listing_arrival', id: booking.listing_id }, where)) || null;
        }

        const [{ data: guestP }, { data: hostP }, { data: msgs }, { data: extras }] = await Promise.all([
            admin.from('profiles').select('full_name, first_name, last_name, preferred_name, show_full_name').eq('id', booking.guest_id).maybeSingle(),
            admin.from('profiles').select('full_name, first_name, last_name, preferred_name, show_full_name').eq('id', uid).maybeSingle(),
            admin.from('messages').select('sender_id, body, created_at, automated, photo_count')
                .eq('booking_id', booking.id).order('created_at', { ascending: false }).limit(MESSAGES_READ),
            admin.from('listing_extras').select('label, description, price, unit').eq('listing_id', booking.listing_id).eq('active', true).order('sort_order'),
        ]);
        const guestFirst = firstName(guestP, 'there');
        const hostFirst = hostByline(hostP, null, 'the host');

        const input: ReplyInput = {
            hostFirst, guestFirst,
            listing: {
                ...(listing || {}),
                check_in_time: formatTime(listing && listing.check_in_time) || null,
                check_in_end_time: formatTime(listing && listing.check_in_end_time) || null,
                check_out_time: formatTime(listing && listing.check_out_time) || null,
            },
            booking,
            address: rules.address && listing ? [listing.street_address, listing.postcode, listing.location].filter(Boolean).join(', ') : null,
            arrivalDirections: rules.address ? (arrival && arrival.arrival_directions) || null : null,
            what3words: rules.address ? (arrival && arrival.what3words) || null : null,
            payment: {
                status: booking.payment_status || null,
                paid: booking.amount_paid != null ? Math.round((Number(booking.amount_paid) - Number(booking.amount_refunded || 0)) * 100) / 100 : null,
                total: booking.total_price != null ? Number(booking.total_price) : null,
                balance: booking.balance_amount != null ? Number(booking.balance_amount) : null,
                balanceDue: booking.balance_due_date ? String(booking.balance_due_date).slice(0, 10) : null,
            },
            cancellation: (() => {
                const cw = cancellationWords(booking.cancellation_policy, booking.cancellation_custom_days);
                // The trip page's own sum (lib/cancellationView): what cancelling
                // TODAY would refund, so the draft never does date arithmetic.
                const pos = cancellationPosition({
                    checkIn: String(booking.check_in).slice(0, 10),
                    policy: booking.cancellation_policy || null,
                    customDays: booking.cancellation_custom_days,
                    nonRefundable: booking.non_refundable === true,
                    amountPaid: Number(booking.amount_paid || 0),
                    alreadyRefunded: Number(booking.amount_refunded || 0),
                    cleaningFee: booking.cleaning_fee,
                });
                return {
                    summary: cw.summary,
                    freeUntil: pos.kind === 'free' && pos.freeUntilKey ? proseDate(pos.freeUntilKey) : null,
                    nonRefundable: booking.non_refundable === true,
                    ifCancelledToday: { kind: pos.kind, refund: Number(pos.amount) || 0, paid: Number(pos.paidSoFar) || 0 },
                    startsToday: String(booking.check_in).slice(0, 10) <= londonDayKey(new Date()),
                };
            })(),
            secretsReleaseAt: arrivalSecretsReleaseAt(booking, release, listing && listing.check_in_time),
            extras: (extras || []).map((x: any) => ({ label: x.label, description: x.description, price: Number(x.price) || 0, unit: x.unit || 'stay' })),
            doorCode: rules.secrets ? doorCode : null,
            wifiName: rules.secrets ? (arrival && arrival.wifi_name) || null : null,
            wifiPassword: rules.secrets ? wifiPassword : null,
            messages: (msgs || []).slice().reverse().map((m: any) => ({
                fromGuest: m.sender_id === booking.guest_id && m.sender_id !== booking.host_id,
                senderFirst: m.sender_id === booking.guest_id ? guestFirst : 'host',
                // Check-in messages carry the code as a placeholder; the model
                // reads the placeholder, never the value.
                body: messagePreview(renderSecretTokens(m.body, m.automated, 'preview'), m.photo_count),
                at: m.created_at,
            })),
        };

        // --- The draft -----------------------------------------------------
        if (!live) {
            await logUsage(admin, { userId: uid, bookingId: booking.id, model: 'stand-in', inputTokens: 0, outputTokens: 0, costUsd: 0, outcome: 'ok', fake: true });
            return NextResponse.json({ ok: true, standIn: true, ...standInDraft(input, rules) });
        }

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 30_000 });
        let response: Anthropic.Message;
        try {
            response = await client.messages.create({
                model: REPLY_MODEL,
                max_tokens: 4000,
                system: REPLY_SYSTEM,
                messages: [{ role: 'user', content: replyPrompt(input, rules) }],
                output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA as any } },
            });
        } catch (err) {
            await logUsage(admin, { userId: uid, bookingId: booking.id, model: REPLY_MODEL, inputTokens: 0, outputTokens: 0, costUsd: 0, outcome: 'api_error', fake: false });
            if (err instanceof Anthropic.RateLimitError) {
                return NextResponse.json({ ok: false, error: 'Suggestions are busy right now — try again in a minute.' }, { status: 503 });
            }
            if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
                await logError('[ai-reply] the API key was refused', err, { path: 'ai-reply' });
                return NextResponse.json({ ok: false, error: 'Suggestions aren’t set up yet.' }, { status: 503 });
            }
            await logError('[ai-reply] API call failed', err, { path: 'ai-reply' });
            return NextResponse.json({ ok: false, error: 'Couldn’t draft a reply. Try again.' }, { status: 502 });
        }

        const inTok = Number(response.usage && response.usage.input_tokens) || 0;
        const outTok = Number(response.usage && response.usage.output_tokens) || 0;
        const cost = costUsd(inTok, outTok, REPLY_MODEL);

        let draft: { reply: string; unconfirmed: string[] } | null = null;
        if (response.stop_reason !== 'refusal') {
            const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
            draft = parseDraft(text, hostFirst);
        }
        await logUsage(admin, {
            userId: uid, bookingId: booking.id, model: REPLY_MODEL, inputTokens: inTok, outputTokens: outTok, costUsd: cost,
            outcome: response.stop_reason === 'refusal' ? 'refusal' : draft ? 'ok' : 'unparsed', fake: false,
        });
        await alertIfNeeded(admin, spent + cost, cap);

        if (!draft) return NextResponse.json({ ok: false, error: 'Couldn’t draft a reply for this one — write it yourself.' }, { status: 422 });
        return NextResponse.json({ ok: true, model: REPLY_MODEL, ...draft });
    } catch (err) {
        await logError('[ai-reply] failed', err, { path: 'ai-reply' });
        return NextResponse.json({ ok: false, error: 'Couldn’t draft a reply. Try again.' }, { status: 500 });
    }
}

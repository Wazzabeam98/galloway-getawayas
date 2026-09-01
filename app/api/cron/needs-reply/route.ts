import { isArchived, needsReply } from '@/lib/conversations';
import { logError } from '@/lib/logError';
import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import {
    sendEmail,
    emailLayout,
    escapeHtml,
    button,
    waitedFor,
    SITE_URL,
} from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A guest asked something and nobody answered.
//
// The inbox already shows this, but only to somebody looking at the inbox. A
// question about arriving tonight sitting unread since yesterday morning is
// the thing this site can least afford, so after twelve hours it goes out by
// email instead of waiting to be found.
//
// Twelve hours rather than a few: a message at nine in the evening should not
// ring an alarm at midnight, and twelve hours puts it in the next morning.
const WAITING_HOURS = 12;

// Nothing older than this is chased. A thread nobody answered a fortnight ago
// is not news, and an email about it reads as noise rather than a nudge.
const OLDEST_DAYS = 7;

// One reminder a day per conversation, however long it goes unanswered. The
// point is to catch something missed, not to nag somebody who has decided to
// deal with it later.
const QUIET_HOURS = 24;

export async function GET(request: Request) {
    // Vercel Cron sends the secret as a bearer token. Without this, anyone who
    // finds the URL could fire off a round of emails.
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    // ?preview=1 builds everything and sends nothing: no mail, no rows in
    // sent_reply_nudges, just the emails that would have gone out. It takes
    // the same secret as the real run, so it gives away nothing that
    // triggering the run does not, and it is the only way to read the wording
    // without either waiting twelve hours or mailing somebody to find out.
    const preview = new URL(request.url).searchParams.get('preview') === '1';

    const admin = adminClient();
    const now = Date.now();

    const waitingSince = new Date(now - WAITING_HOURS * 3600000).toISOString();
    const oldest = new Date(now - OLDEST_DAYS * 86400000).toISOString();

    // Every message in the window, newest first. The newest one in a
    // conversation is the only one that decides anything: if it was sent by
    // the person it is addressed to, the conversation has been answered.
    //
    // Reading the window rather than each conversation in turn keeps this to
    // one query. Anything whose newest message predates the window is older
    // than OLDEST_DAYS and is deliberately left alone.
    // BOOKING CONVERSATIONS ONLY.
    //
    // Since 20260831180000 a message hangs off EITHER a booking or an enquiry,
    // and this whole route is keyed on the booking: it groups by booking_id,
    // looks the bookings up, and reads conversation_prefs and
    // sent_reply_nudges by booking_id. A job-thread message has booking_id
    // null and breaks every one of those steps.
    //
    // It broke them silently, which is the part worth remembering. Every
    // enquiry message collapsed into a single bucket keyed "null"; the newest
    // of them became its representative; and once that one was older than
    // WAITING_HOURS, `bookingIds` contained a null. PostgREST renders that as
    // the literal string, and Postgres answers `invalid input syntax for type
    // uuid: "null"` — so the bookings, prefs and nudges queries all failed,
    // every message fell through `if (!booking)`, and the route returned
    // ok:true with emailed:0. Hosts simply stopped being chased, and nothing
    // anywhere said so.
    //
    // Job threads get their own nudge when they get one; they are not this
    // route's business. Excluded in the query rather than filtered afterwards,
    // so the null can never reach the grouping in the first place.
    //
    // This is one of two placeholders that come off together when the unified
    // inbox learns about job threads, and removing it without handling the
    // null puts the silence back for everybody. See "The unified inbox has two
    // placeholders waiting for it" in OUTSTANDING.md.
    const { data: recent, error: recentError } = await admin
        .from('messages')
        .select('id, booking_id, sender_id, recipient_id, body, created_at')
        .not('booking_id', 'is', null)
        .gte('created_at', oldest)
        .order('created_at', { ascending: false });

    // Read rather than ignored. An unread error here is a day on which nobody
    // is chased, reported as a quiet day — see above for what that cost.
    if (recentError) {
        await logError('needs-reply: could not load the recent messages', recentError, {
            path: '/api/cron/needs-reply',
        });
        return NextResponse.json(
            { ok: false, error: 'Could not load the recent messages' },
            { status: 500 }
        );
    }

    const newestByBooking: Record<string, any> = {};
    (recent || []).forEach((m: any) => {
        if (!newestByBooking[m.booking_id]) newestByBooking[m.booking_id] = m;
    });

    // Waiting: the last word was the guest's, and it has been there long
    // enough. recipient_id is who owes the answer.
    const waiting = Object.keys(newestByBooking)
        .map((id) => newestByBooking[id])
        .filter((m: any) => m.created_at <= waitingSince);

    if (waiting.length === 0) {
        return NextResponse.json({ ok: true, waiting: 0, emailed: 0, skipped: 0 });
    }

    const bookingIds = waiting.map((m: any) => m.booking_id);

    const { data: bookings, error: bookingsError } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, host_id, check_in, check_out, status')
        .in('id', bookingIds);

    // The same reasoning as above: without this, a failed lookup empties
    // bookingMap, every message is skipped as "no booking", and the run
    // reports success having chased nobody.
    if (bookingsError) {
        await logError('needs-reply: could not load the bookings behind the messages', bookingsError, {
            path: '/api/cron/needs-reply',
        });
        return NextResponse.json(
            { ok: false, error: 'Could not load the bookings' },
            { status: 500 }
        );
    }

    const bookingMap: Record<string, any> = {};
    (bookings || []).forEach((b: any) => { bookingMap[b.id] = b; });

    const { data: listings } = await admin
        .from('listings')
        .select('id, title')
        .in('id', Array.from(new Set((bookings || []).map((b: any) => b.listing_id))));

    const listingMap: Record<string, any> = {};
    (listings || []).forEach((l: any) => { listingMap[l.id] = l; });

    // What each person has already said about these conversations: archived,
    // or marked as needing no reply. Both mean they have seen it.
    const { data: prefs } = await admin
        .from('conversation_prefs')
        .select('user_id, booking_id, archived_at, no_reply_needed_at')
        .in('booking_id', bookingIds);

    const prefMap: Record<string, any> = {};
    (prefs || []).forEach((p: any) => { prefMap[p.user_id + ':' + p.booking_id] = p; });

    const { data: nudges } = await admin
        .from('sent_reply_nudges')
        .select('user_id, booking_id, sent_at')
        .in('booking_id', bookingIds);

    const nudgeMap: Record<string, any> = {};
    (nudges || []).forEach((n: any) => { nudgeMap[n.user_id + ':' + n.booking_id] = n; });

    // Grouped per person, so somebody with three guests waiting gets one email
    // listing three rather than three emails.
    const perPerson: Record<string, any[]> = {};
    let skipped = 0;

    for (const message of waiting) {
        const booking = bookingMap[message.booking_id];
        if (!booking) { skipped++; continue; }

        // Nobody is arriving, so nobody is waiting on anything.
        if (booking.status === 'declined') { skipped++; continue; }

        // Only the host side is chased. A guest waiting on a host is a real
        // thing too, but this is the host's escalation and the email says so
        // — mailing a guest to tell them a guest is waiting would be nonsense.
        // Worth revisiting as a separate nudge with its own wording.
        if (message.recipient_id !== booking.host_id) { skipped++; continue; }

        const userId = message.recipient_id;
        const key = userId + ':' + booking.id;
        const pref = prefMap[key];

        // The same question the inbox asks, from the same function, so the
        // email and the count can never disagree about what is waiting.
        if (!needsReply(message, userId, pref && pref.no_reply_needed_at)) {
            skipped++;
            continue;
        }

        // Archiving is also an answer of sorts — they have read it and put it
        // away. A later message would have brought it back on its own.
        if (isArchived(pref && pref.archived_at, message.created_at)) {
            skipped++;
            continue;
        }

        const nudge = nudgeMap[key];
        if (nudge && new Date(nudge.sent_at).getTime() > now - QUIET_HOURS * 3600000) {
            skipped++;
            continue;
        }

        if (!perPerson[userId]) perPerson[userId] = [];
        perPerson[userId].push({ message: message, booking: booking });
    }

    let emailed = 0;
    const previews: any[] = [];

    for (const userId of Object.keys(perPerson)) {
        const items = perPerson[userId];

        try {
            // Message alerts, the same switch that governs the email sent when
            // a message arrives. Somebody who has turned those off has said
            // they do not want the site mailing them about messages, and this
            // is the site mailing them about a message.
            const { data: settings } = await admin
                .from('notification_preferences')
                .select('new_message, unsubscribe_token')
                .eq('user_id', userId)
                .maybeSingle();

            if (settings && settings.new_message === false) {
                skipped += items.length;
                continue;
            }

            const { data: userRes } = await admin.auth.admin.getUserById(userId);
            const to = (userRes && userRes.user && userRes.user.email) || '';
            if (!to) { skipped += items.length; continue; }

            const { data: profile } = await admin
                .from('profiles')
                .select('full_name, preferred_name')
                .eq('id', userId)
                .maybeSingle();

            const first = escapeHtml(
                (((profile && (profile.preferred_name || profile.full_name)) || 'there')
                    .trim().split(' ')[0]) || 'there'
            );

            const rows = items.map((item: any) => {
                const listing = listingMap[item.booking.listing_id];
                const snippet = String(item.message.body || '').slice(0, 140);

                return (
                    '<div style="margin:0 0 14px 0;padding:14px 16px;background-color:#f9fafb;' +
                    'border-left:3px solid #b45309;border-radius:6px;">' +
                    '<div style="font-size:13px;color:#6b7280;">' +
                    escapeHtml((listing && listing.title) || 'A booking') +
                    ' &middot; ' + waitedFor(item.message.created_at, new Date(now)) +
                    '</div>' +
                    '<div style="margin-top:6px;font-size:15px;color:#374151;">' +
                    (escapeHtml(snippet) || '<em>No message text</em>') +
                    (String(item.message.body || '').length > 140 ? '&hellip;' : '') +
                    '</div>' +
                    '</div>'
                );
            }).join('');

            const heading = items.length === 1
                ? 'A guest is waiting on a reply'
                : items.length + ' guests are waiting on a reply';

            const html = emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' +
                heading + '</h1>' +
                '<p style="margin:0 0 18px 0;">Hi ' + first + ' &mdash; ' +
                (items.length === 1
                    ? 'this has been sitting unanswered for over ' + WAITING_HOURS + ' hours.'
                    : 'these have been sitting unanswered for over ' + WAITING_HOURS + ' hours.') +
                '</p>' +
                rows +
                button(SITE_URL + '/messages?b=' + items[0].booking.id, 'Open your messages') +
                '<p style="margin:0;font-size:14px;color:#6b7280;">If there is nothing to answer, ' +
                'use <strong>Mark no reply needed</strong> under the message and it will stop ' +
                'counting as waiting.</p>',
                "You're receiving this because message alerts are switched on in your notification settings.",
                settings && settings.unsubscribe_token
                    ? SITE_URL + '/unsubscribe?token=' + settings.unsubscribe_token + '&type=new_message'
                    : undefined
            );

            const subject = heading + ' \u2014 Galloway Getaways';

            if (preview) {
                previews.push({ to: to, subject: subject, html: html });
                emailed += items.length;
                continue;
            }

            const delivered = await sendEmail(to, subject, html);

            if (!delivered) { skipped += items.length; continue; }

            // Recorded only once the mail is away, so a send that failed is
            // tried again on the next run rather than counted as done.
            for (const item of items) {
                await admin.from('sent_reply_nudges').upsert(
                    {
                        user_id: userId,
                        booking_id: item.booking.id,
                        message_id: item.message.id,
                        sent_at: new Date().toISOString(),
                    },
                    { onConflict: 'user_id,booking_id' }
                );
            }

            emailed += items.length;
        } catch (err: any) {
            console.error('[needs-reply] user', userId, err && err.message);
            skipped += items.length;
        }
    }

    return NextResponse.json({
        ok: true,
        preview: preview,
        waiting: waiting.length,
        people: Object.keys(perPerson).length,
        emailed: emailed,
        skipped: skipped,
        ...(preview ? { emails: previews } : {}),
    });
}

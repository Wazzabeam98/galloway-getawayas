// Texting a tradesman, one way only.
//
// ---------------------------------------------------------------------------
// THIS CHANNEL IS ONE-WAY AND MUST STAY THAT WAY
// ---------------------------------------------------------------------------
//
// NOTHING CAN EVER BE ACCEPTED BY REPLYING TO A TEXT. A tradesman accepts
// through the link or through his email, and that accept is the only thing
// that reveals a name, a number or an address. There is no inbound webhook,
// no long number, and no parsing of "yes" — deliberately, not because it was
// too much work.
//
// The reason is what a wrong guess costs. Matching an inbound text back to an
// enquiry means looking the sender up, finding his open enquiries and hoping
// there is exactly one; with two open, "yes" is ambiguous and accepting the
// wrong one sends a tradesman to the wrong house and hands a stranger's
// address to somebody who never asked for it. An accept is the single event
// this whole flow is built to produce and it has to be unambiguous.
//
// So: the sender is alphanumeric, which CANNOT receive replies at all. That is
// the feature. A reply is impossible rather than ignored, and the message says
// so in plain words so nobody thumbs "yes" at it and believes they have
// answered.
//
// IF REPLYING BY TEXT EVER LOOKS TEMPTING, IT IS A CONVERSATION TO HAVE
// BEFORE IT IS A THING TO BUILD.
//
// ---------------------------------------------------------------------------
// WHY TWILIO, AND WHY OVER HTTPS RATHER THAN THE SDK
// ---------------------------------------------------------------------------
//
// Not because it is cheapest — AWS SNS is — but because with no fallback left
// in the flow, "did he see it" IS the product, and Twilio's delivery receipts
// are the best documented way to answer it. See scripts/check-sms.mjs, which
// is the SMS half of what check-email.mjs already does for Resend.
//
// Plain fetch, no SDK, exactly like lib/email.ts talks to Resend: one endpoint,
// no dependency to keep current, and nothing to go wrong in a build.

// UK alphanumeric sender IDs need no registration and cannot be replied to.
const DEFAULT_SENDER = 'GallowayGG';

export interface SmsResult {
    ok: boolean;
    sid?: string;
    skipped?: string;
    error?: string;
}

// ---------------------------------------------------------------------------
// ONE SEGMENT, AND THE CHARACTERS THAT QUIETLY COST TWO
// ---------------------------------------------------------------------------
//
// A GSM-7 message is 160 characters for the price of one. Go over and it
// splits into two 153-character segments and costs twice as much; use a single
// character outside GSM-7 — a curly apostrophe, an en dash, an emoji — and the
// whole message becomes UCS-2 at SEVENTY characters a segment, so a 100
// character text silently becomes two.
//
// That is the trap this file exists to avoid, and it is invisible: nothing
// fails, the message arrives, and the bill is double. So the message is built
// to fit and there are tests on both the length and the alphabet.

export const SMS_LIMIT = 160;

// The GSM 03.38 basic set, minus the extension characters that cost two units
// each. Straight quotes only — a smart apostrophe is the likeliest way this
// gets broken by somebody being tidy.
const GSM7 = new Set(
    ('@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
    + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
    + '\n\r').split('')
);

export function isGsm7(text: string): boolean {
    return String(text || '').split('').every((c) => GSM7.has(c));
}

// ---------------------------------------------------------------------------
// THE MESSAGE
// ---------------------------------------------------------------------------
//
// LINK FIRST. He is reading a notification on a lock screen, and the link is
// the only thing he can act on. Everything after it is context for deciding
// whether to tap.
//
// The trade and the town are the two facts that decide it — a roofer forty
// miles away wants to know it is a roof and where before he opens anything.
//
// It is built to fit rather than trimmed afterwards: the fixed words and the
// URL are counted, and whatever is left is shared between the trade and the
// town. "Painter & decorator in Gatehouse of Fleet" is the realistic worst
// case and it is what the test uses.
export function emergencySms(
    url: string,
    trade: string,
    town: string
): string {
    const head = String(url || '').trim();

    // Straight apostrophe. A curly one is outside GSM-7 and would take the
    // whole message to 70 characters a segment — see isGsm7, and the test.
    const tail = ". Tap to accept. Replies don't reach us.";

    // "Emergency " + trade + " in " + town
    const fixed = head.length + ' Emergency '.length + ' in '.length + tail.length;
    const room = SMS_LIMIT - fixed;

    let where = String(town || '').trim();
    let what = String(trade || '').trim().toLowerCase();

    // The town goes first if something has to give: he can infer the trade
    // from the link, and cannot infer whether it is worth the drive.
    if (what.length + where.length > room) {
        what = what.slice(0, Math.max(0, room - where.length)).trim();
    }
    if (what.length + where.length > room) {
        where = where.slice(0, Math.max(0, room - what.length)).trim();
    }

    return head + ' Emergency ' + what + ' in ' + where + tail;
}

// ---------------------------------------------------------------------------
// SENDING
// ---------------------------------------------------------------------------
//
// Returns rather than throws, exactly like sendEmail: a text that fails to go
// must never break the enquiry that triggered it. The row is already written
// and the email has already gone.

export async function sendSms(to: string, body: string): Promise<SmsResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_SMS_FROM || DEFAULT_SENDER;

    if (!sid || !token) {
        console.error('[sms] Twilio is not configured — nothing sent.');
        return { ok: false, skipped: 'not configured' };
    }
    if (!to) {
        console.error('[sms] No recipient number — nothing sent.');
        return { ok: false, skipped: 'no number' };
    }

    try {
        const res = await fetch(
            'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json',
            {
                method: 'POST',
                headers: {
                    Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
            }
        );

        const detail = await res.json();

        if (!res.ok) {
            console.error('[sms] Twilio rejected the message:', res.status, detail && detail.message);
            return { ok: false, error: String((detail && detail.message) || res.status) };
        }

        // The SID is how scripts/check-sms.mjs asks what became of it later.
        return { ok: true, sid: String(detail.sid || '') };
    } catch (err: any) {
        console.error('[sms] Could not reach Twilio:', err);
        return { ok: false, error: String(err && err.message) };
    }
}

// UK numbers as a tradesman writes them — "07700 900123", "+44 7700 900123",
// "(01557) 555 0117" — into the E.164 Twilio wants.
//
// Returns null rather than guessing. A number that cannot be parsed with
// confidence is one nobody should be texting: the failure mode of guessing is
// a stranger's phone going off about somebody's boiler.
export function toE164(raw: string | null | undefined): string | null {
    const digits = String(raw || '').replace(/[^\d+]/g, '');
    if (!digits) return null;

    if (digits.startsWith('+44')) return digits.length === 13 ? digits : null;
    if (digits.startsWith('+')) return null;          // not ours to interpret
    if (digits.startsWith('44')) return digits.length === 12 ? '+' + digits : null;
    if (digits.startsWith('07')) return digits.length === 11 ? '+44' + digits.slice(1) : null;

    // A landline is not a mobile and will not receive a text. Refusing is
    // better than paying to send into nothing.
    return null;
}

// What happened to the last few texts, without borrowing somebody's phone.
//
// Read-only. It creates nothing, sends nothing and changes nothing, so it is
// safe to run in the middle of a test.
//
// WHY THIS MATTERS MORE THAN THE EMAIL ONE
//
// An emergency enquiry has no fallback behind it. Nothing is released, nothing
// is escalated: if the tradesman does not see it, the enquiry expires and the
// owner is told to ring somebody else. So "did he see it" is not a diagnostic
// question here, it is the product, and the only honest answer comes from the
// carrier rather than from the fact that we called an API successfully.
//
// THE STATUS LADDER, AND THE ONE THAT LIES
//
//   queued / sending   Twilio has it. Says nothing about his phone.
//   sent               handed to the carrier. STILL NOT DELIVERED — this is
//                      the one that reads like success and is not, the exact
//                      shape of Resend's `sent` in check-email.mjs.
//   delivered          the handset acknowledged it. The only good answer.
//   undelivered        the carrier gave up. Common for a landline typed into
//                      a mobile field, and invisible without this.
//   failed             rejected outright — bad number, blocked sender.
//
// Anything that is not `delivered` is listed again at the end, because a
// failure eight rows up is a failure nobody sees.
//
// Usage:
//   node scripts/check-sms.mjs                  last 20 messages
//   node scripts/check-sms.mjs --to 07700900123 just that number
//   node scripts/check-sms.mjs --sid SMxxxx     one message
//   node scripts/check-sms.mjs --watch          re-check every 5s

import { loadEnv } from './seed-lib.mjs';

const env = loadEnv();
const args = process.argv.slice(2);

const pick = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
};

const only = pick('--to');
const sid = pick('--sid');
const watch = args.includes('--watch');

const ACCOUNT = env.TWILIO_ACCOUNT_SID;
const TOKEN = env.TWILIO_AUTH_TOKEN;

if (!ACCOUNT || !TOKEN) {
    console.error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set in .env.local.');
    console.error('Nothing to check — this is the Twilio half and there is no other source.');
    process.exit(1);
}

const auth = 'Basic ' + Buffer.from(ACCOUNT + ':' + TOKEN).toString('base64');

// Straight from the tradesman's point of view: what reached him, and when.
const GOOD = ['delivered'];
const PENDING = ['queued', 'accepted', 'sending', 'sent'];

function line(m) {
    const when = m.date_sent || m.date_created;
    const ago = when ? Math.round((Date.now() - new Date(when).getTime()) / 60000) : null;
    const age = ago === null ? '' : ago < 60 ? ago + 'm ago' : Math.round(ago / 60) + 'h ago';

    const body = String(m.body || '').replace(/\s+/g, ' ').slice(0, 58);

    return '    to ' + String(m.to || '—').padEnd(16)
        + ' | "' + body + '"'
        + (age ? '  |  ' + age : '');
}

async function twilio(path) {
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + ACCOUNT + path, {
        headers: { Authorization: auth },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body && body.message ? body.message : 'twilio responded ' + res.status);
    return body;
}

async function check() {
    let messages = [];

    if (sid) {
        messages = [await twilio('/Messages/' + sid + '.json')];
    } else {
        const query = only ? '?To=' + encodeURIComponent(only) + '&PageSize=20' : '?PageSize=20';
        const body = await twilio('/Messages.json' + query);
        messages = body.messages || [];
    }

    if (!messages.length) {
        console.log('\n  No texts sent yet.\n');
        return;
    }

    const bad = [];

    console.log('');
    for (const m of messages) {
        const status = String(m.status || '');

        if (GOOD.includes(status)) {
            console.log('  DELIVERED — it reached his phone');
        } else if (PENDING.includes(status)) {
            // Said out loud rather than rounded up. "sent" means Twilio handed
            // it to the carrier and nothing more, and treating that as arrival
            // is how an unseen emergency looks fine in a report.
            console.log('  ' + status.toUpperCase() + ' — not delivered yet, and it may never be');
            bad.push(m);
        } else {
            console.log('  ' + status.toUpperCase() + ' — it did not arrive'
                + (m.error_message ? ': ' + m.error_message : ''));
            bad.push(m);
        }

        console.log(line(m));

        // Segments and price, because the whole message is built to fit in one
        // and a two is a design fault rather than a billing surprise.
        const segments = Number(m.num_segments || 1);
        if (segments > 1) {
            console.log('    SPLIT INTO ' + segments + ' SEGMENTS — over 160 GSM-7 characters,'
                + ' or a character outside GSM-7. See emergencySms in lib/sms.ts.');
        }
    }

    if (bad.length) {
        console.log('\n  Not confirmed delivered:');
        for (const m of bad) console.log('    ' + m.to + '  ' + m.status + '  ' + m.sid);
        console.log('\n  With no fallback behind an emergency, one of these is a job that did not happen.');
    }

    console.log('');
}

await check();

if (watch) {
    setInterval(() => {
        console.clear();
        check().catch((e) => console.error(e.message));
    }, 5000);
}

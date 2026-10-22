import { emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { REFERRAL_REWARDS, ReferralType } from '@/lib/referrals';

// The one email the referral scheme sends: the referrer, told their reward is
// due, when the person they referred reaches their first completed booking (a
// stay or experience) or first paid month (a trade). Built here so the payout
// crons / webhook that send it stay about money, and so the copy can be tested
// on its own. First names only, as everywhere.

// What happened, per type — the clause after "Good news —".
function milestone(type: ReferralType, referredFirst: string): string {
    const who = referredFirst ? escapeHtml(referredFirst) : 'someone you referred';
    switch (type) {
        case 'experience':
            return who + '’s first experience booking has been and gone';
        case 'trade':
            return who + ' has started paying for their Galloway Getaways listing';
        case 'stay':
        default:
            return who + '’s first guests have stayed and checked out';
    }
}

export function referralRewardDueEmail(
    referrerFirstName: string,
    referredFirstName: string | null,
    type: ReferralType
): { subject: string; html: string } {
    const reward = REFERRAL_REWARDS[type];
    const name = escapeHtml((referrerFirstName || '').trim() || 'there');

    const subject = 'Your £' + reward + ' referral reward is on its way';

    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;">Hello ' + name + ',</p>'
        + '<p style="margin:0 0 16px;font-size:16px;">Good news — '
        + milestone(type, (referredFirstName || '').trim())
        + ', so a person you referred to Galloway Getaways is up and running. That'
        + ' means your <strong>£' + reward + '</strong> reward is due.</p>'
        + '<p style="margin:0 0 16px;font-size:16px;">We pay referral rewards by bank'
        + ' transfer. We’ll be in touch to arrange it — there’s nothing'
        + ' you need to do.</p>'
        + '<p style="margin:0 0 16px;font-size:16px;">Thank you for spreading the word.'
        + ' Know anyone else with a holiday let, experience or service?</p>'
        + button(SITE_URL + '/refer', 'Refer someone else'),
        'You’re receiving this because you referred someone to Galloway Getaways.'
    );

    return { subject, html };
}

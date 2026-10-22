import { emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { REFERRAL_REWARD_GBP } from '@/lib/referrals';

// The one email the referral scheme sends: the referrer, told their reward is
// due, when their referred host's first stay completes. Built here so the
// host-payouts cron that sends it stays about money, and so the copy can be
// tested on its own. First names only, as everywhere.

export function referralRewardDueEmail(
    referrerFirstName: string,
    referredFirstName: string | null
): { subject: string; html: string } {
    const who = (referredFirstName || '').trim();
    const hostBit = who ? escapeHtml(who) + '’s first guests have' : 'your host’s first guests have';
    const name = escapeHtml((referrerFirstName || '').trim() || 'there');

    const subject = 'Your £' + REFERRAL_REWARD_GBP + ' referral reward is on its way';

    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;">Hello ' + name + ',</p>'
        + '<p style="margin:0 0 16px;font-size:16px;">Good news — ' + hostBit
        + ' stayed and checked out, so a host you referred to Galloway Getaways is up'
        + ' and running. That means your <strong>£' + REFERRAL_REWARD_GBP
        + '</strong> reward is due.</p>'
        + '<p style="margin:0 0 16px;font-size:16px;">We pay referral rewards by bank'
        + ' transfer. We’ll be in touch to arrange it — there’s nothing you'
        + ' need to do.</p>'
        + '<p style="margin:0 0 16px;font-size:16px;">Thank you for spreading the word.'
        + ' Know anyone else with a holiday let?</p>'
        + button(SITE_URL + '/refer', 'Refer another host'),
        'You’re receiving this because you referred a host to Galloway Getaways.'
    );

    return { subject, html };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { flagIsTrue } from '@/lib/serviceOrders';
import { recipients, sendEmailToAll, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { alertLevel, londonMonth, monthStartIso, monthlyCapUsd } from '@/lib/replySuggest';

// The server half of AI-suggested replies: the switch, the monthly spend cap and
// its alert, and the usage log. The rules themselves are lib/replySuggest.

/**
 * The switch. Held on PRODUCTION until AI_REPLY_SUGGESTIONS=true is set there
 * (a redeploy binds it); previews and local are always on, the same as the
 * other launch switches, so the feature can be walked. Read tolerantly
 * (flagIsTrue), and anything else means off.
 */
export function aiReplySuggestionsOn(): boolean {
    if (process.env.VERCEL_ENV !== 'production') return true;
    return flagIsTrue(process.env.AI_REPLY_SUGGESTIONS);
}

/** A real key is set — on production nothing else is used. */
export function hasApiKey(): boolean {
    return !!String(process.env.ANTHROPIC_API_KEY || '').trim();
}

/** What this calendar month (Europe/London) has cost so far, in USD. */
export async function spentThisMonth(admin: SupabaseClient, now: Date = new Date()): Promise<number> {
    const month = londonMonth(now);
    const { data } = await admin
        .from('ai_usage_log')
        .select('cost_usd, created_at')
        .gte('created_at', monthStartIso(now))
        .limit(100000);
    let total = 0;
    for (const r of data || []) {
        // The lower bound is a day early to be safe across the clock change;
        // only rows in this London month count.
        if (londonMonth(new Date(r.created_at)) === month) total += Number(r.cost_usd) || 0;
    }
    return Math.round(total * 1_000_000) / 1_000_000;
}

export function capUsd(): number {
    return monthlyCapUsd(process.env.AI_REPLY_MONTHLY_CAP_USD);
}

/**
 * Email the directors once when the month passes 80% of the cap, and once when
 * it reaches it. The (month, level) primary key is what stops a second email.
 * Never throws.
 */
export async function alertIfNeeded(admin: SupabaseClient, spent: number, cap: number, now: Date = new Date()): Promise<void> {
    try {
        const level = alertLevel(spent, cap);
        if (!level) return;
        const month = londonMonth(now);
        const { data: inserted, error } = await admin
            .from('ai_spend_alerts')
            .insert({ month, level, spent_usd: spent, cap_usd: cap })
            .select('month')
            .maybeSingle();
        if (error || !inserted) return; // already sent for this level this month
        const to = recipients(process.env.DISPUTES_ALERT_EMAIL);
        if (!to.length) {
            await logError('[ai-reply] spend alert has nowhere to go (DISPUTES_ALERT_EMAIL unset)', null, { path: 'ai-reply' });
            return;
        }
        const headline = level === '100'
            ? 'AI reply suggestions reached this month’s cap and are paused'
            : 'AI reply suggestions have used 80% of this month’s cap';
        const html = emailLayout(
            '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">' + escapeHtml(headline) + '</h1>'
            + '<p style="margin:0 0 12px 0;">Spent so far in ' + escapeHtml(month) + ': <strong>$' + spent.toFixed(2)
            + '</strong> of a $' + cap.toFixed(2) + ' cap.</p>'
            + (level === '100'
                ? '<p style="margin:0 0 12px 0;">Hosts see “Suggestions are paused for this month” until the 1st, or until the cap (AI_REPLY_MONTHLY_CAP_USD) is raised.</p>'
                : '<p style="margin:0 0 12px 0;">Suggestions stop when the cap is reached.</p>')
            + button(SITE_URL + '/admin/ai-usage', 'See the usage'),
            'You are receiving this because you are a director of Galloway Getaways.'
        );
        await sendEmailToAll(to, headline, html);
    } catch (err) {
        await logError('[ai-reply] spend alert failed', err, { path: 'ai-reply' });
    }
}

export async function logUsage(admin: SupabaseClient, row: {
    userId: string; bookingId: string; model: string;
    inputTokens: number; outputTokens: number; costUsd: number; outcome: string; fake: boolean;
}): Promise<void> {
    const { error } = await admin.from('ai_usage_log').insert({
        user_id: row.userId, booking_id: row.bookingId, model: row.model,
        input_tokens: row.inputTokens, output_tokens: row.outputTokens, cost_usd: row.costUsd,
        outcome: row.outcome, fake: row.fake,
    });
    if (error) await logError('[ai-reply] usage log insert failed', error, { path: 'ai-reply' });
}

import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { aiReplySuggestionsOn, capUsd, hasApiKey } from '@/lib/aiReplyServer';
import { londonMonth } from '@/lib/replySuggest';
import { ukDateTime } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';

// What the AI reply suggestions have cost. Admin only (requireAdmin); read
// through the service role because ai_usage_log has no policy for any browser
// role. Totals by London calendar month — the month the cap counts — and the
// latest drafts asked for.
export default async function AdminAiUsagePage() {
    await requireAdmin();

    const admin = adminClient();
    const since = new Date(Date.now() - 370 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await admin
        .from('ai_usage_log')
        .select('id, created_at, user_id, booking_id, model, input_tokens, output_tokens, cost_usd, outcome, fake')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);

    if (error) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-16">
                <h1 className="text-2xl font-bold text-slate-900">AI reply suggestions</h1>
                <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Could not load the usage: {error.message}</p>
            </main>
        );
    }

    const rows = data || [];
    const byMonth: Record<string, { drafts: number; cost: number; input: number; output: number }> = {};
    for (const r of rows) {
        const m = londonMonth(new Date(r.created_at));
        const t = (byMonth[m] = byMonth[m] || { drafts: 0, cost: 0, input: 0, output: 0 });
        t.drafts += 1;
        t.cost += Number(r.cost_usd) || 0;
        t.input += Number(r.input_tokens) || 0;
        t.output += Number(r.output_tokens) || 0;
    }
    const months = Object.keys(byMonth).sort().reverse();
    const thisMonth = londonMonth();
    const cap = capUsd();
    const spent = (byMonth[thisMonth] && byMonth[thisMonth].cost) || 0;

    return (
        <main className="mx-auto max-w-5xl px-4 py-12">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">AI reply suggestions</h1>
            <p className="mt-2 text-sm text-slate-500">
                {aiReplySuggestionsOn() ? 'Switched on' : 'Switched off (AI_REPLY_SUGGESTIONS)'} · {hasApiKey() ? 'API key set' : 'No API key set'} ·
                {' '}this month ${spent.toFixed(2)} of a ${cap.toFixed(2)} cap
            </p>

            <h2 className="mt-8 text-base font-bold text-slate-900">By month</h2>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
                <thead><tr className="text-left text-slate-500"><th className="py-2">Month</th><th>Drafts</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th></tr></thead>
                <tbody>
                    {months.length === 0 && <tr><td colSpan={5} className="py-3 text-slate-400">No drafts yet.</td></tr>}
                    {months.map((m) => (
                        <tr key={m} className="border-t border-slate-100">
                            <td className="py-2">{m}</td><td>{byMonth[m].drafts}</td>
                            <td>{byMonth[m].input.toLocaleString('en-GB')}</td><td>{byMonth[m].output.toLocaleString('en-GB')}</td>
                            <td>${byMonth[m].cost.toFixed(4)}</td>
                        </tr>
                    ))}
                </tbody>
            </table></div>

            <h2 className="mt-10 text-base font-bold text-slate-900">Latest drafts</h2>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
                <thead><tr className="text-left text-slate-500"><th className="py-2">When</th><th>Booking</th><th>Model</th><th>Tokens in / out</th><th>Cost</th><th>Outcome</th></tr></thead>
                <tbody>
                    {rows.slice(0, 100).map((r: any) => (
                        <tr key={r.id} className="border-t border-slate-100">
                            <td className="py-2">{ukDateTime(r.created_at)}</td>
                            <td className="font-mono text-xs">{r.booking_id ? String(r.booking_id).slice(0, 8) : '—'}</td>
                            <td>{r.fake ? 'stand-in (preview)' : r.model}</td>
                            <td>{r.input_tokens} / {r.output_tokens}</td>
                            <td>${Number(r.cost_usd || 0).toFixed(4)}</td>
                            <td>{r.outcome}</td>
                        </tr>
                    ))}
                </tbody>
            </table></div>
        </main>
    );
}

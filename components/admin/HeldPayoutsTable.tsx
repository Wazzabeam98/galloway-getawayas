import { adminClient } from '@/lib/supabaseAdmin';
import { loadHeldOrders, heldSummary, type HeldSummary } from '@/lib/heldPayouts';
import { londonDayKey, ukDate, ukDateTime } from '@/lib/dayKey';
import { formatGBP } from '@/lib/formatMoney';

// Experience providers with money held — approved and live, payouts not set up,
// so the experience-payouts run is holding their share. The owner's view of the
// same lib/heldPayouts figures the provider's dashboard and reminder emails use.
// Read-only; nothing here moves money. The run pays them on its first pass
// after Stripe turns their payouts on.
export default async function HeldPayoutsTable({ compact = false }: { compact?: boolean }) {
    const admin = adminClient();
    const { data: providers, error } = await admin
        .from('service_providers')
        .select('id, business_name, provider_name, contact_email, stripe_account_id, stripe_details_submitted, approved_at')
        .eq('audience', 'guest')
        .eq('status', 'approved')
        .or('stripe_payouts_enabled.is.null,stripe_payouts_enabled.eq.false');

    if (error) {
        return <p className="text-sm text-rose-700">Couldn’t load the providers with money held — {error.message}</p>;
    }

    const list = providers || [];
    const orders = await loadHeldOrders(admin, list.map((p: any) => p.id));
    const today = londonDayKey();

    const { data: reminders } = list.length
        ? await admin.from('provider_payout_reminders').select('provider_id, sent_at').in('provider_id', list.map((p: any) => p.id))
        : { data: [] as any[] };
    const lastReminder = new Map<string, string>();
    for (const r of reminders || []) {
        const prev = lastReminder.get(r.provider_id);
        if (!prev || r.sent_at > prev) lastReminder.set(r.provider_id, r.sent_at);
    }

    const rows: Array<{ p: any; s: HeldSummary }> = list
        .map((p: any) => ({ p, s: heldSummary(orders.filter((o) => o.provider_id === p.id), today) }))
        .filter((r) => r.s.waiting > 0 || r.s.upcoming > 0)
        .sort((a, b) => (b.s.waiting - a.s.waiting) || (b.s.upcoming - a.s.upcoming));

    const totalWaiting = rows.reduce((t, r) => t + r.s.waiting, 0);
    const totalUpcoming = rows.reduce((t, r) => t + r.s.upcoming, 0);
    const stripeState = (p: any) => !p.stripe_account_id ? 'Not started' : p.stripe_details_submitted ? 'Submitted, Stripe checking' : 'Started, not finished';

    return (
        <section aria-label="Money held for experience providers">
            <h2 className={compact ? 'text-xs font-bold uppercase tracking-wider text-slate-500 mb-3' : 'text-lg font-bold text-slate-900 mb-1'}>
                Money held — payouts not set up
            </h2>
            {rows.length === 0 ? (
                <p className="text-sm text-slate-500">No experience provider has money held.</p>
            ) : (
                <>
                    <p className="mb-3 text-sm text-slate-600">
                        {formatGBP(Math.round(totalWaiting * 100) / 100)} due now · {formatGBP(Math.round(totalUpcoming * 100) / 100)} from bookings still to come ·{' '}
                        {rows.length} {rows.length === 1 ? 'provider' : 'providers'}. Paid on the first payout run after their Stripe payouts are on.
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-3 py-2">Provider</th>
                                    <th className="px-3 py-2 text-right">Due now</th>
                                    <th className="px-3 py-2 text-right">Coming up</th>
                                    <th className="px-3 py-2">Waiting since</th>
                                    <th className="px-3 py-2">Stripe</th>
                                    <th className="px-3 py-2">Last reminded</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(({ p, s }) => (
                                    <tr key={p.id} className="border-t border-slate-100">
                                        <td className="px-3 py-2">
                                            <div className="font-semibold text-slate-900">{p.business_name}</div>
                                            <div className="text-xs text-slate-500">{p.contact_email}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{s.waiting > 0 ? formatGBP(s.waiting) : '—'}</td>
                                        <td className="px-3 py-2 text-right text-slate-700">{s.upcoming > 0 ? formatGBP(s.upcoming) : '—'}</td>
                                        <td className="px-3 py-2 text-slate-700">{s.oldestWaiting ? ukDate(s.oldestWaiting) : '—'}</td>
                                        <td className="px-3 py-2 text-slate-700">{stripeState(p)}</td>
                                        <td className="px-3 py-2 text-slate-700">{lastReminder.has(p.id) ? ukDateTime(lastReminder.get(p.id)!) : 'Not yet'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
}

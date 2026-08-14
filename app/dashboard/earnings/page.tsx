export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

const HOST_FEE_PERCENT = 10;

export default async function EarningsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();

    const { data: bookings } = await supabase
        .from("bookings")
        .select("*")
        .eq("host_id", user.user?.id);

    const listingIds = Array.from(new Set((bookings || []).map((b) => b.listing_id)));
    const { data: listings } = listingIds.length
        ? await supabase.from("listings").select("id, title").in("id", listingIds)
        : { data: [] };
    const listingMap = new Map((listings || []).map((l) => [l.id, l.title]));

    const today = new Date();
    const confirmed = (bookings || []).filter((b) => b.status === "confirmed");
    const pending = (bookings || []).filter((b) => b.status === "pending");

    const upcoming = confirmed.filter((b) => new Date(b.check_in) >= today);
    const completed = confirmed.filter((b) => new Date(b.check_out) < today);

    const netOf = (gross: number) => gross * (1 - HOST_FEE_PERCENT / 100);

    const grossTotal = confirmed.reduce((sum, b) => sum + Number(b.total_price), 0);
    const netTotal = netOf(grossTotal);
    const feeTotal = grossTotal - netTotal;

    const upcomingNet = netOf(upcoming.reduce((sum, b) => sum + Number(b.total_price), 0));
    const completedNet = netOf(completed.reduce((sum, b) => sum + Number(b.total_price), 0));
    const pendingGross = pending.reduce((sum, b) => sum + Number(b.total_price), 0);

    // Last 6 months, bucketed by check-in month.
    const months: { label: string; net: number }[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const label = d.toLocaleDateString('en-GB', { month: 'short' });
        const monthNet = netOf(
            confirmed
                .filter((b) => {
                    const bd = new Date(b.check_in);
                    return bd.getFullYear() === d.getFullYear() && bd.getMonth() === d.getMonth();
                })
                .reduce((sum, b) => sum + Number(b.total_price), 0)
        );
        months.push({ label, net: monthNet });
    }
    const maxMonth = Math.max(1, ...months.map((m) => m.net));

    // Per-listing breakdown.
    const byListing = new Map<string, number>();
    confirmed.forEach((b) => {
        byListing.set(b.listing_id, (byListing.get(b.listing_id) || 0) + netOf(Number(b.total_price)));
    });
    const listingBreakdown = Array.from(byListing.entries())
        .map(([id, net]) => ({ id, title: listingMap.get(id) || 'Listing', net }))
        .sort((a, b) => b.net - a.net);

    const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
        <div className="border rounded-2xl p-5">
            <div className="text-sm text-slate-500 mb-1">{label}</div>
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto px-6 py-10">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">Earnings</h1>
            <p className="text-slate-500 mb-8">Based on confirmed bookings, after your {HOST_FEE_PERCENT}% host fee.</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                <StatCard label="Total earned" value={`£${netTotal.toFixed(2)}`} sub={`£${grossTotal.toFixed(2)} gross`} />
                <StatCard label="Upcoming payout" value={`£${upcomingNet.toFixed(2)}`} sub={`${upcoming.length} stay${upcoming.length !== 1 ? 's' : ''}`} />
                <StatCard label="Completed stays" value={`£${completedNet.toFixed(2)}`} sub={`${completed.length} stay${completed.length !== 1 ? 's' : ''}`} />
                <StatCard label="Pending requests" value={`£${pendingGross.toFixed(2)}`} sub={`${pending.length} awaiting response`} />
            </div>

            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-1">Last 6 months</h2>
                <p className="text-xs text-slate-400 mb-6">Net payout, by check-in month</p>
                <div className="flex items-end gap-4 h-40">
                    {months.map((m) => (
                        <div key={m.label} className="flex-1 flex flex-col items-center justify-end h-full">
                            <div
                                className="w-full bg-rose-500 rounded-t-lg min-h-[2px]"
                                style={{ height: `${(m.net / maxMonth) * 100}%` }}
                                title={`£${m.net.toFixed(2)}`}
                            />
                            <span className="text-xs text-slate-500 mt-2">{m.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-4">Fee breakdown</h2>
                <div className="space-y-2 text-sm max-w-sm">
                    <div className="flex justify-between text-slate-600">
                        <span>Gross bookings (confirmed)</span>
                        <span>£{grossTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                        <span>Host fee ({HOST_FEE_PERCENT}%)</span>
                        <span>− £{feeTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 pt-2 border-t">
                        <span>Net earnings</span>
                        <span>£{netTotal.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div className="border rounded-2xl p-6">
                <h2 className="font-bold text-slate-900 mb-4">By listing</h2>
                {listingBreakdown.length === 0 ? (
                    <p className="text-sm text-slate-400">No confirmed bookings yet.</p>
                ) : (
                    <div className="space-y-3">
                        {listingBreakdown.map((l) => {
                            const pct = grossTotal > 0 ? (l.net / netTotal) * 100 : 0;
                            return (
                                <div key={l.id}>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="font-medium text-slate-800">{l.title}</span>
                                        <span className="text-slate-600">£{l.net.toFixed(2)}</span>
                                    </div>
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

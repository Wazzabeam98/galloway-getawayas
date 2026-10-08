import { supplierFromSnapshot, vatBreakdown, type SupplierSnapshot } from '@/lib/vat';
import { formatGBP } from '@/lib/formatMoney';

// "Supplied by" on a guest's receipt — the host or provider is the guest's
// supplier (the contract is with them; we take payment on their behalf), so a
// VAT-registered one is named here with their VAT number. Reads the snapshot
// frozen on the booking/order when it was made. Renders nothing at all for a
// supplier who isn't VAT registered.
//
// The price already includes VAT, so nothing is added: `gross` (the total the
// guest paid, shown above on the receipt) is only broken into net + VAT @20% +
// total, so a business guest can reclaim it. The three figures add back to the
// gross exactly. `gross` is what the guest has kept paying for (after refunds).
// A zero-rated, exempt or mixed order (the treatment frozen on it) gets no split.
export default function SupplierVat({ row, gross, what = 'stay' }: {
    row: SupplierSnapshot | null | undefined;
    gross: number;
    what?: string;
}) {
    const supplier = supplierFromSnapshot(row);
    if (!supplier) return null;
    const b = !supplier.noSplit && gross > 0 ? vatBreakdown(gross) : null;
    return (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Supplied by</div>
            <div className="mt-1 text-sm font-medium text-slate-900">{supplier.name}</div>
            <div className="text-sm text-slate-600">VAT number {supplier.vatNumber}</div>

            {b ? (
                <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
                    <div className="text-slate-500">This price includes VAT at 20%</div>
                    <div className="mt-1.5 space-y-1">
                        <div className="flex items-baseline justify-between"><span>Net</span><span className="tabular-nums">{formatGBP(b.net)}</span></div>
                        <div className="flex items-baseline justify-between"><span>VAT (20%)</span><span className="tabular-nums">{formatGBP(b.vat)}</span></div>
                        <div className="flex items-baseline justify-between font-semibold text-slate-800"><span>Total</span><span className="tabular-nums">{formatGBP(b.gross)}</span></div>
                    </div>
                </div>
            ) : supplier.noSplit ? (
                <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">{supplier.noSplit}</div>
            ) : null}

            <div className="mt-2 text-xs text-slate-400">Your {what} is supplied by {supplier.name}. Galloway Getaways takes payment on their behalf.</div>
        </div>
    );
}

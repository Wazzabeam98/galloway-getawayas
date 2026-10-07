import { supplierFromSnapshot } from '@/lib/vat';

// "Supplied by" on a guest's receipt — the host or provider is the guest's
// supplier (the contract is with them; we take payment on their behalf), so a
// VAT-registered one is named here with their VAT number. Reads the snapshot
// frozen on the booking/order when it was made. Renders nothing at all for a
// supplier who isn't VAT registered.
export default function SupplierVat({ row, what = 'stay' }: {
    row: { supplier_vat_number?: string | null; supplier_vat_name?: string | null } | null | undefined;
    what?: string;
}) {
    const supplier = supplierFromSnapshot(row);
    if (!supplier) return null;
    return (
        <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Supplied by</div>
            <div className="mt-1 text-sm font-medium text-slate-900">{supplier.name}</div>
            <div className="text-sm text-slate-600">VAT number {supplier.vatNumber}</div>
            <div className="mt-0.5 text-xs text-slate-400">Your {what} is supplied by {supplier.name}. Galloway Getaways takes payment on their behalf.</div>
        </div>
    );
}

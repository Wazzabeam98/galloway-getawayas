import type { ReviewContent as Content } from '@/lib/serviceProviders';
import { GUEST_SCREEN_COPY } from '@/lib/strings';

// What a guest listing actually contains — the menu with prices and the written
// answers — rendered once for both the claimed review row and the unclaimed
// application payload (see reviewContentFrom). Host/trade rows show their own
// pricing elsewhere, so this is guest-only and returns nothing otherwise.
//
// The point of the price block is that an unbookable listing (no item priced
// above zero) is impossible to approve by accident: it carries a red flag rather
// than reading blank.

function unitLabel(unit: string): string {
    return (GUEST_SCREEN_COPY.priceUnitLabels as Record<string, string>)[unit] || '';
}

function agreedDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-0.5 text-sm text-slate-700 whitespace-pre-line [text-wrap:pretty]">{children}</div>
        </div>
    );
}

export default function ReviewContent({ content }: { content: Content }) {
    if (!content.isGuest) return null;

    const c = content;
    const hasContent = c.title || c.whatHappens || c.qualifications || c.dietary.length || c.dietaryNote;

    return (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
            {/* MENU + PRICE — the bookability check. */}
            <div>
                <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        What they’re selling
                    </div>
                    {c.pricedCount === 0 ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                            No price — unbookable
                        </span>
                    ) : c.priceFrom != null ? (
                        <span className="text-xs font-medium text-slate-500">from £{c.priceFrom}</span>
                    ) : null}
                </div>

                {c.items.length === 0 ? (
                    <div className="mt-1 text-sm text-slate-500">No items added.</div>
                ) : (
                    <ul className="mt-1.5 space-y-1">
                        {c.items.map((it, i) => (
                            <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 text-slate-700">{it.name || <span className="text-slate-400">Untitled item</span>}</span>
                                <span className="flex-none tabular-nums">
                                    {it.priced ? (
                                        <span className="text-slate-900">£{it.price}{unitLabel(it.unit) ? <span className="text-slate-400"> · {unitLabel(it.unit)}</span> : null}</span>
                                    ) : (
                                        <span className="font-medium text-red-700">no price</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* WRITTEN CONTENT — what an approval decision rests on. */}
            {hasContent ? (
                <div className="space-y-3 border-t border-slate-200 pt-4">
                    {c.title ? <Field label="Title">{c.title}</Field> : null}
                    {c.whatHappens ? <Field label="What happens">{c.whatHappens}</Field> : null}
                    {c.qualifications ? <Field label="Qualifications">{c.qualifications}</Field> : null}
                    {(c.dietary.length || c.dietaryNote) ? (
                        <Field label="Dietary">
                            {c.dietary.length ? <span>{c.dietary.join(', ')}</span> : null}
                            {c.dietary.length && c.dietaryNote ? <span className="text-slate-400"> — </span> : null}
                            {c.dietaryNote ? <span>{c.dietaryNote}</span> : null}
                        </Field>
                    ) : null}
                </div>
            ) : null}

            {/* TERMS — the declarations store is the terms acceptance now. */}
            <div className="border-t border-slate-200 pt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Terms</div>
                <div className="mt-0.5 text-sm">
                    {c.termsVersion ? (
                        <span className="text-slate-700">
                            Agreed to provider terms <span className="font-medium">{c.termsVersion}</span>
                            {agreedDate(c.termsAgreedAt) ? ' on ' + agreedDate(c.termsAgreedAt) : ''}
                        </span>
                    ) : (
                        <span className="font-medium text-amber-800">Terms not yet agreed</span>
                    )}
                </div>
            </div>
        </div>
    );
}

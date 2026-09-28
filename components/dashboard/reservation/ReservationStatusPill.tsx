import { CheckCircle2, Clock3, XCircle } from 'lucide-react';

// The status pill in the reservation-page family: a label and one of three tones
// (ok / wait / over), the same set the guest trip page and the host booking page
// use, so a stay and an experience read as one product. Extracted so the host
// reservation page and the provider's reservation card share ONE pill and can
// never drift.

export type StatusTone = 'ok' | 'wait' | 'over';

const PILL: Record<StatusTone, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    wait: 'bg-amber-100 text-amber-800',
    over: 'bg-slate-200 text-slate-600',
};

export default function ReservationStatusPill({ label, tone }: { label: string; tone: StatusTone }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[tone]}`}>
            {tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
            {tone === 'wait' && <Clock3 className="h-3 w-3" />}
            {tone === 'over' && <XCircle className="h-3 w-3" />}
            {label}
        </span>
    );
}

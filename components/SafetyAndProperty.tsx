import { BellRing, AlertTriangle, ShieldAlert, Wallet, Check, Minus } from 'lucide-react';
import { formatGBP } from '@/lib/formatMoney';

// "Safety & property" — the safety facts a guest wants to confirm before they
// book, sat under the house rules the way Airbnb does. The two alarms come from
// the amenities the host already ticks (they live in the amenities list, not
// their own columns); the damage deposit is listings.damage_deposit.
//
// The alarms are shown whether present OR not — an absent smoke alarm is itself
// a thing a guest should know, and showing it is the honest version Airbnb uses.
// The deposit only appears when there is one. If there's nothing at all to say
// (no deposit, and somehow neither alarm resolved), the section doesn't render.
export default function SafetyAndProperty({
    smokeAlarm,
    carbonMonoxideAlarm,
    damageDeposit,
}: {
    smokeAlarm: boolean;
    carbonMonoxideAlarm: boolean;
    damageDeposit: number;
}) {
    const deposit = Number(damageDeposit) || 0;

    const Row = ({
        icon: Icon,
        label,
        present,
        detail,
    }: {
        icon: any;
        label: string;
        present: boolean;
        detail?: string;
    }) => (
        <li className="flex items-start gap-3 text-sm">
            <Icon className="mt-0.5 h-5 w-5 flex-none text-slate-700" strokeWidth={1.5} />
            <span className="flex flex-wrap items-center gap-x-2 text-slate-800">
                <span>{label}</span>
                {detail ? (
                    <span className="text-slate-500">{detail}</span>
                ) : present ? (
                    <Check className="h-4 w-4 text-emerald-600" aria-label="Yes" />
                ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                        <Minus className="h-3.5 w-3.5" /> not reported
                    </span>
                )}
            </span>
        </li>
    );

    return (
        <section className="mt-8 pt-8 border-t">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                <ShieldAlert className="h-5 w-5 text-slate-500" /> Safety &amp; property
            </h2>
            <ul className="mt-4 space-y-3">
                <Row icon={BellRing} label="Smoke alarm" present={smokeAlarm} />
                <Row icon={AlertTriangle} label="Carbon monoxide alarm" present={carbonMonoxideAlarm} />
                {deposit > 0 && (
                    <Row
                        icon={Wallet}
                        label="Damage deposit"
                        present
                        detail={`${formatGBP(deposit)} — held and collected by the host, not charged by Galloway Getaways.`}
                    />
                )}
            </ul>
        </section>
    );
}

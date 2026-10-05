'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ClipboardList, ShieldCheck, CalendarClock, LogIn, LogOut, KeyRound, Users, PawPrint,
    PartyPopper, Cigarette, Moon, Info, BellRing, AlertTriangle, Wallet, Check, Minus,
    X, ChevronRight, Video, Volume2, Waves, Mountain, Footprints, ShieldAlert,
} from 'lucide-react';
import {
    SAFETY_DISCLOSURES, CHECKOUT_INSTRUCTIONS, cleanItems, labelFor, type ListingItem,
} from '@/lib/listingDisclosures';
import { formatGBP } from '@/lib/formatMoney';
import { cancellationSummary } from '@/lib/cancellation';
import { cancellationDisplay, CLEANING_FEE_NOTE } from '@/lib/cancellationDisplay';
import { checkInMethodTitle, checkInBlurb, isSelfCheckIn } from '@/lib/checkInMethods';

// Airbnb's "Things to know": three columns side by side — House rules, Safety &
// property, Cancellation policy — each an icon, a title, a few summary lines and
// a "Show more" that opens a dialog. On a phone the three stack.
//
// Replaces the old House rules + Safety & property sections on the listing page.

type Props = {
    checkInTime: string | null;
    checkOutTime: string | null;
    checkInMethod: string | null;
    maxGuests: number;
    petsAllowed: boolean;
    eventsAllowed: boolean;
    smokingAllowed: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    additionalRules: string | null;
    smokeAlarm: boolean;
    carbonMonoxideAlarm: boolean;
    damageDeposit: number;
    cancellationPolicy: string | null;
    // listings.safety_disclosures / checkout_instructions — raw jsonb, cleaned here.
    safetyDisclosures?: any;
    checkoutInstructions?: any;
};

const DISCLOSURE_ICONS: Record<string, any> = {
    security_cameras: Video,
    noise_monitor: Volume2,
    nearby_water: Waves,
    heights: Mountain,
    dangerous_animals: PawPrint,
    pool_no_gate: Waves,
    climbing_structure: Footprints,
};

// "15:00" — the 24-hour clock Airbnb UK uses. null/blank → ''.
function hm(value: string | null): string {
    if (!value) return '';
    const [h, m] = String(value).split(':');
    if (h === undefined) return '';
    return h.padStart(2, '0') + ':' + (m || '00').slice(0, 2).padStart(2, '0');
}

export default function ThingsToKnow(props: Props) {
    const {
        checkInTime, checkOutTime, checkInMethod, maxGuests, petsAllowed, eventsAllowed,
        smokingAllowed, quietHoursEnabled, quietHoursStart, quietHoursEnd, additionalRules,
        smokeAlarm, carbonMonoxideAlarm, damageDeposit, cancellationPolicy,
    } = props;
    const disclosures: ListingItem[] = cleanItems(props.safetyDisclosures, SAFETY_DISCLOSURES);
    const checkoutSteps: ListingItem[] = cleanItems(props.checkoutInstructions, CHECKOUT_INSTRUCTIONS);

    const [openCol, setOpenCol] = useState<null | 'rules' | 'safety' | 'cancel'>(null);

    // Date-aware cancellation, matching the booking card. The check-in comes from
    // the URL (the booking card writes it) and the card's date event.
    const [checkIn, setCheckIn] = useState<string | null>(null);
    useEffect(() => {
        try {
            const p = new URLSearchParams(window.location.search);
            setCheckIn(p.get('check_in'));
        } catch { /* ignore */ }
        const onDates = (e: Event) => setCheckIn((e as CustomEvent).detail?.checkIn || null);
        window.addEventListener('gg:booking-dates', onDates as EventListener);
        return () => window.removeEventListener('gg:booking-dates', onDates as EventListener);
    }, []);

    useEffect(() => {
        if (!openCol) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenCol(null); };
        window.addEventListener('keydown', onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
    }, [openCol]);

    const checkInHM = hm(checkInTime) || '15:00';
    const checkOutHM = hm(checkOutTime) || '11:00';
    const policy = cancellationDisplay(cancellationPolicy);
    const dated = checkIn ? cancellationSummary(checkIn, cancellationPolicy) : null;

    // ---- column summaries (2–3 lines each) ----
    const rulesLines = [
        `Check-in after ${checkInHM}`,
        `Checkout before ${checkOutHM}`,
        `${maxGuests} guest${maxGuests === 1 ? '' : 's'} maximum`,
    ];
    // Airbnb leads with what a guest most needs warning of — the cameras, the
    // water, the drop — and then the alarms. Three lines at most; the rest is
    // behind Show more.
    const safetyLines: string[] = disclosures.map((d) => labelFor(SAFETY_DISCLOSURES, d.key));
    safetyLines.push(smokeAlarm ? 'Smoke alarm' : 'No smoke alarm reported');
    safetyLines.push(carbonMonoxideAlarm ? 'Carbon monoxide alarm' : 'No carbon monoxide alarm reported');
    if (damageDeposit > 0) safetyLines.push(`${formatGBP(damageDeposit)} damage deposit`);
    safetyLines.splice(3);
    const cancelLines = dated ? [dated.headline] : policy.bullets.slice(0, 2);

    // ---- dialog bodies ----
    const Row = ({ icon: Icon, children }: { icon: any; children: React.ReactNode }) => (
        <li className="flex items-start gap-3 border-b border-slate-100 py-3.5 last:border-0 text-sm text-slate-800">
            <Icon className="mt-0.5 h-5 w-5 flex-none text-slate-700" strokeWidth={1.5} />
            <span>{children}</span>
        </li>
    );

    const rulesDialog = (
        <>
            <h4 className="text-base font-semibold text-slate-900">Checking in and out</h4>
            <ul className="mt-1">
                <Row icon={LogIn}>Check-in after {checkInHM}</Row>
                <Row icon={LogOut}>Checkout before {checkOutHM}</Row>
                {isSelfCheckIn(checkInMethod) && (
                    <Row icon={KeyRound}>
                        {checkInMethodTitle(checkInMethod)} — {checkInBlurb(checkInMethod).replace(/\.$/, '')}
                    </Row>
                )}
            </ul>
            <h4 className="mt-6 text-base font-semibold text-slate-900">During your stay</h4>
            <ul className="mt-1">
                <Row icon={Users}>{maxGuests} guest{maxGuests === 1 ? '' : 's'} maximum</Row>
                <Row icon={PawPrint}>{petsAllowed ? 'Pets allowed' : 'No pets'}</Row>
                <Row icon={PartyPopper}>{eventsAllowed ? 'Events and parties allowed' : 'No parties or events'}</Row>
                <Row icon={Cigarette}>{smokingAllowed ? 'Smoking allowed' : 'No smoking, vaping or e-cigarettes'}</Row>
                {quietHoursEnabled && (
                    <Row icon={Moon}>Quiet hours {hm(quietHoursStart) || '22:00'}–{hm(quietHoursEnd) || '07:00'}</Row>
                )}
                {additionalRules && additionalRules.trim() && (
                    <Row icon={Info}>
                        <span className="whitespace-pre-line">{additionalRules.trim()}</span>
                    </Row>
                )}
            </ul>
            {checkoutSteps.length > 0 && (
                <>
                    <h4 className="mt-6 text-base font-semibold text-slate-900">Before you leave</h4>
                    <ul className="mt-1">
                        {checkoutSteps.map((c) => (
                            <Row key={c.key} icon={LogOut}>
                                {labelFor(CHECKOUT_INSTRUCTIONS, c.key)}
                                {c.note && <span className="block text-slate-500 whitespace-pre-line">{c.note}</span>}
                            </Row>
                        ))}
                    </ul>
                </>
            )}
        </>
    );

    const safetyDialog = (
        <>
        {disclosures.length > 0 && (
            <>
                <h4 className="text-base font-semibold text-slate-900">Safety considerations</h4>
                <ul className="mt-1 mb-5">
                    {disclosures.map((d) => (
                        <Row key={d.key} icon={DISCLOSURE_ICONS[d.key] || ShieldAlert}>
                            {labelFor(SAFETY_DISCLOSURES, d.key)}
                            {d.note && <span className="block text-slate-500 whitespace-pre-line">{d.note}</span>}
                        </Row>
                    ))}
                </ul>
                <h4 className="text-base font-semibold text-slate-900">Safety devices</h4>
            </>
        )}
        <ul>
            <Row icon={BellRing}>
                Smoke alarm{' '}
                {smokeAlarm
                    ? <Check className="ml-1 inline h-4 w-4 text-emerald-600" />
                    : <span className="ml-1 inline-flex items-center gap-1 text-slate-400"><Minus className="h-3.5 w-3.5" /> not reported</span>}
            </Row>
            <Row icon={AlertTriangle}>
                Carbon monoxide alarm{' '}
                {carbonMonoxideAlarm
                    ? <Check className="ml-1 inline h-4 w-4 text-emerald-600" />
                    : <span className="ml-1 inline-flex items-center gap-1 text-slate-400"><Minus className="h-3.5 w-3.5" /> not reported</span>}
            </Row>
            {damageDeposit > 0 && (
                <Row icon={Wallet}>
                    <span className="font-medium text-slate-900">{formatGBP(damageDeposit)} damage deposit</span>
                    <span className="block text-slate-500">Held and collected by the host.</span>
                </Row>
            )}
        </ul>
        </>
    );

    const cancelDialog = (
        <div className="space-y-4">
            {dated && (
                <div className="rounded-xl bg-slate-50 p-4">
                    <div className="font-semibold text-slate-900">{dated.headline}</div>
                    <p className="mt-1 text-sm text-slate-600">{dated.detail}</p>
                </div>
            )}
            <div>
                <div className="text-sm font-semibold text-slate-900">{policy.key} cancellation policy</div>
                <ul className="mt-2 space-y-1.5">
                    {policy.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="mt-2 h-1 w-1 flex-none rounded-full bg-slate-400" />
                            {b}
                        </li>
                    ))}
                </ul>
            </div>
            <p className="text-sm text-slate-500">{CLEANING_FEE_NOTE}</p>
        </div>
    );

    const columns = [
        { key: 'rules' as const, icon: ClipboardList, title: 'House rules', lines: rulesLines, body: rulesDialog },
        { key: 'safety' as const, icon: ShieldCheck, title: 'Safety & property', lines: safetyLines, body: safetyDialog },
        { key: 'cancel' as const, icon: CalendarClock, title: 'Cancellation policy', lines: cancelLines, body: cancelDialog },
    ];

    const active = columns.find((c) => c.key === openCol) || null;

    return (
        <section className="mt-8 pt-8 border-t">
            <h2 className="text-xl md:text-2xl font-bold text-slate-900">Things to know</h2>
            <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
                {columns.map((col) => (
                    <div key={col.key}>
                        <col.icon className="h-6 w-6 text-slate-700" strokeWidth={1.5} />
                        <h3 className="mt-2 font-semibold text-slate-900">{col.title}</h3>
                        <ul className="mt-2 space-y-1 text-sm text-slate-600">
                            {col.lines.map((l, i) => <li key={i}>{l}</li>)}
                        </ul>
                        <button
                            type="button"
                            onClick={() => setOpenCol(col.key)}
                            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-900 underline underline-offset-4"
                        >
                            Show more <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>

            {active && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
                    onClick={() => setOpenCol(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={active.title}
                >
                    <div
                        className="relative mt-6 w-full max-w-lg rounded-2xl bg-white shadow-xl sm:mt-12"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 flex items-center justify-between rounded-t-2xl border-b border-slate-100 bg-white px-6 py-4">
                            <h3 className="text-lg font-semibold text-slate-900">{active.title}</h3>
                            <button
                                type="button"
                                onClick={() => setOpenCol(null)}
                                aria-label="Close"
                                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"
                            >
                                <X className="h-5 w-5 text-slate-700" />
                            </button>
                        </div>
                        <div className="px-6 pb-6 pt-4">{active.body}</div>
                    </div>
                </div>,
                document.body
            )}
        </section>
    );
}

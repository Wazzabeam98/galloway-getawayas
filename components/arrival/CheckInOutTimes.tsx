'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { DoorOpen, DoorClosed, ChevronRight } from 'lucide-react';
import { formatTime } from '@/lib/utils';
import { checkInMethodTitle, checkInBlurb } from '@/lib/checkInMethods';

// The check-in and checkout times, as a matched pair — one component, three
// surfaces (home card, trips card, Getting there). Two boxes of equal width and
// equal weight so neither reads as the more important; a door swinging open for
// arrival and shut for departure, so the icon carries the meaning before the
// label is read. They stay side by side at 375px on purpose: "3pm" and "11am"
// are short enough to pair at a glance, and stacking would lose the pairing.
//
// On the home and trips cards the whole pair links through to Getting there
// (mode="link"). On Getting there itself each box opens in place (mode="expand")
// — arrival to the full window and the self-check-in method when the host set
// them, checkout to any departure note. Everything is conditional: no end time,
// no window; no method, no chip; nothing extra, no toggle — a host who filled in
// nothing still gets two clean boxes with two times in them.

interface Times {
    checkInTime: string | null | undefined;
    checkOutTime: string | null | undefined;
    checkInEndTime?: string | null;
    checkInMethod?: string | null;
    /** Host's own words for leaving. No column feeds this yet; the box simply
     *  stays closed until one does. */
    checkoutDetail?: string | null;
}

type Surface = 'home' | 'trips' | 'arrival';

interface Props extends Times {
    surface: Surface;
    // mode="link": the pair is a single link to `href`.
    // mode="expand": each box with extra detail opens in place.
    mode: 'link' | 'expand';
    href?: string;
}

// Per-surface chrome, so the pair sits inside whatever card surrounds it rather
// than announcing itself as a different component.
const BOX: Record<Surface, string> = {
    home: 'rounded-2xl border border-stone-200 bg-white shadow-sm',
    trips: 'rounded-xl border border-slate-200 bg-white shadow-sm',
    arrival: 'rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/80',
};
const LABEL: Record<Surface, string> = {
    home: 'text-stone-500',
    trips: 'text-slate-500',
    arrival: 'text-stone-500',
};
const TIME: Record<Surface, string> = {
    home: 'text-stone-900',
    trips: 'text-slate-900',
    arrival: 'text-stone-900',
};

function BoxInner({
    icon,
    label,
    time,
    surface,
}: {
    icon: any;
    label: string;
    time: string;
    surface: Surface;
}) {
    return (
        <div className="flex items-start gap-3">
            {/* The existing emerald, at a tenth, so the tint belongs to the site
                rather than introducing a colour. */}
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700">
                {icon}
            </span>
            <div className="min-w-0">
                <div className={`text-[11px] font-semibold uppercase tracking-wide ${LABEL[surface]}`}>
                    {label}
                </div>
                {/* The time is the largest thing in the box. */}
                <div className={`text-2xl font-semibold leading-tight ${TIME[surface]}`}>
                    {time}
                </div>
            </div>
        </div>
    );
}

export default function CheckInOutTimes(props: Props) {
    const { surface, mode, href } = props;
    const inTime = formatTime(props.checkInTime) || '—';
    const outTime = formatTime(props.checkOutTime) || '—';

    const arrivalIcon = <DoorOpen className="h-5 w-5" strokeWidth={1.75} />;
    const departIcon = <DoorClosed className="h-5 w-5" strokeWidth={1.75} />;

    // ---- link mode: the whole pair goes to Getting there --------------------
    if (mode === 'link') {
        return (
            <Link
                href={href || '#'}
                className="group grid grid-cols-2 gap-3 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/60 focus-visible:ring-offset-2"
                aria-label="Arrival and departure times — open Getting there"
            >
                <div className={`${BOX[surface]} p-3.5 transition group-hover:border-emerald-600/40 group-hover:shadow-md`}>
                    <BoxInner icon={arrivalIcon} label="Check-in" time={inTime} surface={surface} />
                </div>
                <div className={`relative ${BOX[surface]} p-3.5 transition group-hover:border-emerald-600/40 group-hover:shadow-md`}>
                    <BoxInner icon={departIcon} label="Checkout" time={outTime} surface={surface} />
                    <ChevronRight className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-300 transition group-hover:text-emerald-700" />
                </div>
            </Link>
        );
    }

    // ---- expand mode: each box opens in place on Getting there --------------
    return (
        <div className="grid grid-cols-2 gap-3">
            <ExpandBox
                surface={surface}
                icon={arrivalIcon}
                label="Check-in"
                time={inTime}
                detail={<ArrivalDetail checkInTime={props.checkInTime} checkInEndTime={props.checkInEndTime} checkInMethod={props.checkInMethod} />}
                hasDetail={!!(formatTime(props.checkInEndTime) || props.checkInMethod)}
            />
            <ExpandBox
                surface={surface}
                icon={departIcon}
                label="Checkout"
                time={outTime}
                detail={props.checkoutDetail ? <p className="whitespace-pre-line text-sm leading-relaxed text-stone-700">{props.checkoutDetail}</p> : null}
                hasDetail={!!props.checkoutDetail}
            />
        </div>
    );
}

function ExpandBox({
    surface,
    icon,
    label,
    time,
    detail,
    hasDetail,
}: {
    surface: Surface;
    icon: any;
    label: string;
    time: string;
    detail: any;
    hasDetail: boolean;
}) {
    const [open, setOpen] = useState(false);
    const panelId = useId();

    // No extra to show — a plain box, never a dead or disabled-looking control.
    if (!hasDetail) {
        return (
            <div className={`${BOX[surface]} p-3.5`}>
                <BoxInner icon={icon} label={label} time={time} surface={surface} />
            </div>
        );
    }

    return (
        <div className={`${BOX[surface]} p-3.5`}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-controls={panelId}
                className="block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/60"
            >
                <div className="flex items-start justify-between gap-2">
                    <BoxInner icon={icon} label={label} time={time} surface={surface} />
                    <ChevronRight
                        className={`mt-1 h-4 w-4 flex-none text-stone-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                    />
                </div>
            </button>
            {/* grid-rows 0fr→1fr is a height animation that collapses cleanly to
                an instant toggle under prefers-reduced-motion. */}
            <div
                id={panelId}
                className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
                style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
            >
                <div className="overflow-hidden">
                    <div className="pt-3">{detail}</div>
                </div>
            </div>
        </div>
    );
}

function ArrivalDetail({
    checkInTime,
    checkInEndTime,
    checkInMethod,
}: {
    checkInTime: string | null | undefined;
    checkInEndTime?: string | null;
    checkInMethod?: string | null;
}) {
    const from = formatTime(checkInTime);
    const end = formatTime(checkInEndTime);
    return (
        <div className="space-y-2.5">
            {end && (
                <p className="text-sm leading-relaxed text-stone-700">
                    Arrive any time from {from || 'check-in'} until {end}.
                </p>
            )}
            {checkInMethod && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-600/10 p-2.5">
                    <DoorOpen className="mt-0.5 h-4 w-4 flex-none text-emerald-700" strokeWidth={1.75} />
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-emerald-900">{checkInMethodTitle(checkInMethod)}</div>
                        {checkInBlurb(checkInMethod) && (
                            <div className="text-sm text-emerald-800/90">{checkInBlurb(checkInMethod)}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

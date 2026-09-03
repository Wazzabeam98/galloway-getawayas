'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { DoorOpen, DoorClosed, ChevronDown } from 'lucide-react';
import { formatTime } from '@/lib/utils';
import { checkInMethodTitle, checkInBlurb } from '@/lib/checkInMethods';

// The check-in and checkout of a stay, as a vertical rail — one component, three
// surfaces (home card, trips card, Getting there).
//
// It used to be two large boxes carrying only a time, with the dates stranded up
// in the card header. That is a lot of height for two short times, and it split
// the two facts a guest pairs in their head — WHEN they arrive and WHEN they
// leave — across two parts of the card. This is Airbnb's shape instead: a rail
// down the left with the day and date at each end of the stay, joined by a line,
// and a compact row beside each with the door icon, the label and the time. Half
// the height, and it carries the dates the boxes never did.
//
// The door still swings open for arrival and shut for departure, the tint is the
// site's emerald at a tenth, and the pairing survives 375px because each end is
// one short line. On the home and trips cards the whole rail links to Getting
// there (mode="link"); on Getting there itself each end opens in place
// (mode="expand") — arrival to the full window and the self check-in method,
// checkout to any departure note.

interface Times {
    checkInTime: string | null | undefined;
    checkOutTime: string | null | undefined;
    // The calendar days of the stay, so the rail can carry them. 'yyyy-mm-dd'
    // (or an ISO string); absent just leaves the date line off that end.
    checkInDate?: string | null;
    checkOutDate?: string | null;
    checkInEndTime?: string | null;
    checkInMethod?: string | null;
    /** Host's own words for leaving. No column feeds this yet; the box simply
     *  stays closed until one does. */
    checkoutDetail?: string | null;
}

type Surface = 'home' | 'trips' | 'arrival';

interface Props extends Times {
    surface: Surface;
    // mode="link": the whole rail is a single link to `href`.
    // mode="expand": each end with extra detail opens in place.
    // mode="static": the rail just shows the two ends — no link, no toggle. The
    //   trips card uses this now that everything the rail used to link THROUGH to
    //   lives on the card itself, so the times are a fact to read, not a door.
    mode: 'link' | 'expand' | 'static';
    href?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Fri 12 Sep" — read on the UTC parts so the day it names never drifts by zone.
function dateLabel(key: string | null | undefined): string {
    if (!key) return '';
    const d = new Date(String(key).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

// Per-surface chrome, so the rail sits inside whatever card surrounds it.
const CARD: Record<Surface, string> = {
    home: 'rounded-2xl border border-slate-200 bg-white shadow-sm',
    trips: 'rounded-xl border border-slate-200 bg-white shadow-sm',
    arrival: 'rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80',
};

// The rail node: the door icon in an emerald circle, with the connecting line
// dropping from it to the next node (unless it's the last).
function Node({ icon, last }: { icon: any; last?: boolean }) {
    return (
        <div className="relative flex flex-col items-center self-stretch">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700">
                {icon}
            </span>
            {!last && <span className="mt-1 w-px flex-1 bg-emerald-600/25" aria-hidden />}
        </div>
    );
}

// The compact row beside a node. The label sits on top; the date and time read
// as ONE line under it — "Fri 12 Sep · 3pm" — rather than the date hard left and
// the time hard right. On a wide card those two ends stranded the pairing across
// the whole width, so the eye had to travel from a date to its time; kept
// together, the fact a guest holds in their head (arrive Friday at 3) reads at a
// glance, and it still fits one line at 375px.
function RowHead({ label, date, time }: { label: string; date: string; time: string }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="leading-tight text-slate-900">
                {date ? <span className="text-sm text-slate-600">{date} · </span> : null}
                <span className="text-base font-semibold">{time}</span>
            </div>
        </div>
    );
}

export default function CheckInOutTimes(props: Props) {
    const { surface, mode, href } = props;
    const inTime = formatTime(props.checkInTime) || '—';
    const outTime = formatTime(props.checkOutTime) || '—';
    const inDate = dateLabel(props.checkInDate);
    const outDate = dateLabel(props.checkOutDate);

    const arrivalIcon = <DoorOpen className="h-5 w-5" strokeWidth={1.75} />;
    const departIcon = <DoorClosed className="h-5 w-5" strokeWidth={1.75} />;

    // ---- link mode: the whole rail goes to Getting there --------------------
    if (mode === 'link') {
        return (
            <Link
                href={href || '#'}
                className={`group block ${CARD[surface]} p-4 outline-none transition hover:shadow-md hover:ring-emerald-600/30 focus-visible:ring-2 focus-visible:ring-emerald-600/60`}
                aria-label="Arrival and departure — open Getting there"
            >
                <div className="flex items-stretch gap-3">
                    <Node icon={arrivalIcon} />
                    <div className="flex-1 pb-4">
                        <RowHead label="Check-in" date={inDate} time={inTime} />
                    </div>
                </div>
                <div className="flex items-stretch gap-3">
                    <Node icon={departIcon} last />
                    <div className="flex-1">
                        <RowHead label="Checkout" date={outDate} time={outTime} />
                    </div>
                </div>
            </Link>
        );
    }

    // ---- static mode: the rail just shows the two ends, no link, no toggle --
    if (mode === 'static') {
        return (
            <div className={`${CARD[surface]} p-4`}>
                <div className="flex items-stretch gap-3">
                    <Node icon={arrivalIcon} />
                    <div className="flex-1 pb-4"><RowHead label="Check-in" date={inDate} time={inTime} /></div>
                </div>
                <div className="flex items-stretch gap-3">
                    <Node icon={departIcon} last />
                    <div className="flex-1"><RowHead label="Checkout" date={outDate} time={outTime} /></div>
                </div>
            </div>
        );
    }

    // ---- expand mode: each end opens in place on Getting there --------------
    return (
        <div className={`${CARD[surface]} p-4`}>
            <ExpandRow
                icon={arrivalIcon}
                label="Check-in"
                date={inDate}
                time={inTime}
                detail={<ArrivalDetail checkInTime={props.checkInTime} checkInEndTime={props.checkInEndTime} checkInMethod={props.checkInMethod} />}
                hasDetail={!!(formatTime(props.checkInEndTime) || props.checkInMethod)}
            />
            <ExpandRow
                icon={departIcon}
                label="Checkout"
                date={outDate}
                time={outTime}
                detail={props.checkoutDetail ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{props.checkoutDetail}</p> : null}
                hasDetail={!!props.checkoutDetail}
                last
            />
        </div>
    );
}

function ExpandRow({
    icon, label, date, time, detail, hasDetail, last,
}: {
    icon: any; label: string; date: string; time: string; detail: any; hasDetail: boolean; last?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const panelId = useId();

    const head = <RowHead label={label} date={date} time={time} />;

    return (
        <div className="flex items-stretch gap-3">
            <Node icon={icon} last={last} />
            <div className={`flex-1 ${last ? '' : 'pb-4'}`}>
                {hasDetail ? (
                    <>
                        <button
                            type="button"
                            onClick={() => setOpen((o) => !o)}
                            aria-expanded={open}
                            aria-controls={panelId}
                            className="flex w-full items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/60"
                        >
                            {head}
                            <ChevronDown className={`h-4 w-4 flex-none text-slate-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
                        </button>
                        <div
                            id={panelId}
                            className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
                            style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                        >
                            <div className="overflow-hidden">
                                <div className="pt-3">{detail}</div>
                            </div>
                        </div>
                    </>
                ) : head}
            </div>
        </div>
    );
}

function ArrivalDetail({
    checkInTime, checkInEndTime, checkInMethod,
}: {
    checkInTime: string | null | undefined; checkInEndTime?: string | null; checkInMethod?: string | null;
}) {
    const from = formatTime(checkInTime);
    const end = formatTime(checkInEndTime);
    return (
        <div className="space-y-2.5">
            {end && (
                <p className="text-sm leading-relaxed text-slate-700">
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

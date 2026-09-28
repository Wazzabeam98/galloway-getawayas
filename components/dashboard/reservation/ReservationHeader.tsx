import ReservationStatusPill, { type StatusTone } from './ReservationStatusPill';

// The Airbnb-style reservation header, shared by the holiday-let host booking
// page and the provider's reservation card so the two stay in step: the person
// large and centred (their initial on a soft green circle when there is no
// photo), the item photo tucked into the bottom-right corner, then the heading
// ("Liam's group of 2"), a line or two of detail (the date and time, the item),
// and a status pill.

export default function ReservationHeader({
    avatarUrl,
    initial,
    photoUrl,
    heading,
    sublines,
    status,
    size = 'lg',
}: {
    avatarUrl: string | null;
    initial: string;
    photoUrl: string | null;
    heading: string;
    sublines: string[];
    status?: { label: string; tone: StatusTone } | null;
    // 'lg' on the full host/provider page, 'sm' in the narrow messages pane.
    size?: 'lg' | 'sm';
}) {
    const av = size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-16 w-16 text-xl';
    // The listing photo now sits BESIDE the avatar, a rounded tile overlapping its
    // right edge by a hair rather than covering the centre — so a guest's initial
    // is never hidden behind the property. Bigger than the old corner badge, and
    // pulled in with a small negative margin so the pair reads as one unit.
    const photo = size === 'lg' ? 'h-16 w-16' : 'h-11 w-11';
    const overlap = size === 'lg' ? '-ml-4' : '-ml-3';
    const h = size === 'lg' ? 'mt-4 text-2xl' : 'mt-3 text-lg';
    return (
        <div className="flex flex-col items-center text-center">
            <div className="flex items-end justify-center">
                {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className={`${av} rounded-full object-cover ring-1 ring-slate-200`} />
                ) : (
                    <span className={`flex ${av} items-center justify-center rounded-full bg-emerald-50 font-semibold text-emerald-700`}>{initial}</span>
                )}
                {photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" className={`${photo} ${overlap} rounded-2xl object-cover ring-2 ring-white shadow-[0_4px_12px_rgba(0,0,0,0.12)]`} />
                )}
            </div>
            <h1 className={`${h} font-semibold tracking-tight text-slate-900`}>{heading}</h1>
            {sublines.filter(Boolean).map((line, i) => (
                <p key={i} className={(i === 0 ? 'mt-1 ' : '') + 'text-sm text-slate-500'}>{line}</p>
            ))}
            {status && (
                <span className="mt-3">
                    <ReservationStatusPill label={status.label} tone={status.tone} />
                </span>
            )}
        </div>
    );
}

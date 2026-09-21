// The white "Today" / "Tomorrow" / "In 3 days" / "In 1 week" pill Airbnb puts on
// an upcoming booking's photo. ONE component, used on the experience order page
// hero AND the dashboard experience cards, so the wording and the styling stay
// identical. No 'use client': it has no hooks, so it renders on the server (the
// order page) and in a client tree (the dashboard cards) alike.
//
// The parent must be positioned (relative) — the pill is absolute, top-left.
// Returns null once the date is past, so a finished booking never claims to be
// upcoming.

export function untilBadgeLabel(dateStr: string): string | null {
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return null;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `In ${days} days`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return 'In 1 week';
    if (weeks < 9) return `In ${weeks} weeks`;
    return null;
}

export default function WhenBadge({ date, className = '' }: { date: string; className?: string }) {
    const label = untilBadgeLabel(date);
    if (!label) return null;
    return (
        <span className={'absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm ' + className}>
            {label}
        </span>
    );
}

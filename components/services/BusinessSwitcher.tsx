'use client';

// Which business the dashboard is showing, for someone who can work on more than
// one — their own and one they co-host, or two they co-host. The business
// dashboard is built for one business at a time, so this picks which, the way a
// host's dashboard lets a co-host move between properties. Remembered in the
// gg_business cookie (lib/providerAccess BUSINESS_COOKIE). Nothing at all for
// someone with a single business.

import { useRouter } from 'next/navigation';

export default function BusinessSwitcher({ options, current, className }: {
    options: { id: string; name: string }[];
    current: string;
    className?: string;
}) {
    const router = useRouter();
    if (options.length < 2) return null;
    return (
        <label className={'inline-flex items-center gap-2 text-sm text-slate-600 ' + (className || '')}>
            <span className="sr-only">Business</span>
            <select
                value={current}
                onChange={(e) => {
                    document.cookie = 'gg_business=' + encodeURIComponent(e.target.value) + '; path=/; max-age=31536000; samesite=lax';
                    router.refresh();
                }}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
            >
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
        </label>
    );
}

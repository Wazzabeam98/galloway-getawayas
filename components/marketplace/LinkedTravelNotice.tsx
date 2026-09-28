'use client';

// The linked-travel-arrangement notice, shown above the pay button on the
// experience checkout to a guest with a confirmed stay. Collapsed to one line
// with a click to expand the full wording beneath. Both come from
// lib/linkedTravelNotice (one place, swapped for the solicitor's final text).
//
// Render this ONLY on the stay-linked experience checkout — never standalone,
// and nowhere else. The `show` prop is the stay gate; when false it renders
// nothing.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LTA_NOTICE_SUMMARY, LTA_NOTICE_FULL } from '@/lib/linkedTravelNotice';

export default function LinkedTravelNotice({ show }: { show: boolean }) {
    const [open, setOpen] = useState(false);
    if (!show) return null;

    return (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex w-full items-start gap-2 text-left"
            >
                <span className="flex-1">{LTA_NOTICE_SUMMARY}</span>
                <ChevronDown
                    className={'mt-0.5 h-4 w-4 flex-none text-slate-400 transition-transform ' + (open ? 'rotate-180' : '')}
                    aria-hidden
                />
                <span className="sr-only">{open ? 'Hide details' : 'Read the full notice'}</span>
            </button>
            {open && <p className="mt-2 leading-relaxed text-slate-600">{LTA_NOTICE_FULL}</p>}
        </div>
    );
}

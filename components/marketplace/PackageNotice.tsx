'use client';

// The package notice, drawn above the pay button on the experience checkout when
// the picked date falls within one of the guest's own confirmed, paid stays.
// Wording and the covering-stay rule: lib/packageNotice.ts.
//
// The stay windows come from the server (the listing page reads them with the
// service role for the signed-in guest) through PackageStaysProvider, so every
// checkout dialog on the page — slot, request, basket — reads the same list
// without threading it through each panel. No provider, or no stays: nothing
// is drawn. The order route re-decides on its own; this only draws the line.

import { createContext, useContext, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { PACKAGE_NOTICE_TEXT, hasCoveringStay, type StayWindow } from '@/lib/packageNotice';

const PackageStays = createContext<StayWindow[]>([]);

export function PackageStaysProvider({ stays, children }: { stays: StayWindow[]; children: ReactNode }) {
    return <PackageStays.Provider value={stays}>{children}</PackageStays.Provider>;
}

export default function PackageNotice({ date }: { date: string | null | undefined }) {
    const stays = useContext(PackageStays);
    if (!hasCoveringStay(stays, date)) return null;
    return (
        <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-slate-600" data-package-notice>
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" aria-hidden />
            <span>{PACKAGE_NOTICE_TEXT}</span>
        </p>
    );
}

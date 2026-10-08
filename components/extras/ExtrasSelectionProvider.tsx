'use client';

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ListingExtra } from '@/lib/listingExtras';

// The one place a guest's choice of extras lives on a listing page, so the
// "Extras this host offers" cards and the booking panel are the SAME selection:
// adding on a card shows in the panel's total and goes on the booking, and the
// count on the card and the stepper in the panel always agree. Lifted out of
// BookingWidget (which used to own it) so both surfaces can read and write it.
//
// It also carries the bridge the cards need to the booking flow: whether dates
// are chosen yet (reported up by BookingWidget), and a request to prompt for
// them (registered by BookingWidget) so a card tapped before dates exist opens
// the date picker the way the rest of the flow does.

const MAX_EXTRA_QTY = 10;

interface ExtrasSelectionValue {
    qtys: Record<string, number>;
    setQty: (id: string, n: number) => void;
    // True once a valid stay is picked. BookingWidget owns the dates and reports
    // this up; the cards read it to decide whether adding should prompt.
    hasDates: boolean;
    setHasDates: (v: boolean) => void;
    // Ask the booking flow to prompt for dates (opens the mobile sheet on the
    // calendar, or draws attention to the always-visible desktop calendar).
    requestDates: () => void;
    registerDatePrompt: (fn: () => void) => void;
}

const Ctx = createContext<ExtrasSelectionValue | null>(null);

export function ExtrasSelectionProvider({ children }: { extras?: ListingExtra[]; children: ReactNode }) {
    const [qtys, setQtys] = useState<Record<string, number>>({});
    const [hasDates, setHasDates] = useState(false);
    const promptRef = useRef<() => void>(() => {});

    const value = useMemo<ExtrasSelectionValue>(() => ({
        qtys,
        setQty: (id, n) => setQtys((q) => {
            const next = Math.max(0, Math.min(MAX_EXTRA_QTY, Math.floor(Number(n) || 0)));
            if (next <= 0) {
                const { [id]: _drop, ...rest } = q;
                return rest;
            }
            return { ...q, [id]: next };
        }),
        hasDates,
        setHasDates,
        requestDates: () => promptRef.current(),
        registerDatePrompt: (fn) => { promptRef.current = fn; },
    }), [qtys, hasDates]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Null when there is no provider above (BookingWidget used somewhere without the
// listing page) — callers fall back to their own local state in that case.
export function useExtrasSelection(): ExtrasSelectionValue | null {
    return useContext(Ctx);
}

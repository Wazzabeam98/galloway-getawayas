'use client';

import { createContext, useContext, useState, useCallback } from 'react';

// Connects the "What you get" menu (left column) to the booking panel (right
// column) for a comes-to-you experience, the same way FoodCart connects the
// made-to-order menu to its basket. The guest chooses an OPTION on the listing;
// pressing its button parks a request here, and the panel opens its dialog with
// that item already chosen — so the option list is gone from the dialog and only
// guests, date and time remain.
//
// The provider is optional: a page that renders the panel WITHOUT wrapping it
// (there is none today, but the panel must not crash) simply gets a null
// context and opens its dialog on its own default item.

interface PendingOpen {
    itemId: string | null;   // the chosen option, or null to open on the default
    date: string | null;     // a suggested date to land on, or null
    nonce: number;           // lets the same option be re-opened after closing
}

interface RequestBookingCtx {
    pending: PendingOpen | null;
    // Ask the panel to open its dialog on this option (and optionally a date).
    openItem: (itemId: string | null, date?: string | null) => void;
    // The panel calls this once it has acted on a pending request.
    consume: () => void;
}

const Ctx = createContext<RequestBookingCtx | null>(null);

export function RequestBookingProvider({ children }: { children: React.ReactNode }) {
    const [pending, setPending] = useState<PendingOpen | null>(null);
    const openItem = useCallback((itemId: string | null, date: string | null = null) => {
        setPending({ itemId, date, nonce: Date.now() });
    }, []);
    const consume = useCallback(() => setPending(null), []);
    return <Ctx.Provider value={{ pending, openItem, consume }}>{children}</Ctx.Provider>;
}

export function useRequestBooking(): RequestBookingCtx | null {
    return useContext(Ctx);
}

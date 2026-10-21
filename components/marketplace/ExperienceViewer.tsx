'use client';

// Everything on an experience page that depends on WHO is looking, or on the
// minute it is looked at — fetched after load, so the page's HTML is the same for
// everyone and can be edge-cached (app/experiences/browse/[providerId]/page.tsx).
//
//   * signedIn      — whether the booking panel is an anonymous checkout or the
//                     viewer's own (the guest-terms tick, the address book).
//   * canReply      — the provider (or a co-host with messages) gets the reply box
//                     under each review.
//   * packageStays  — the viewer's own paid stays, for the package notice.
//   * availability  — the live calendar (sessions and seats left, hours, day-offs,
//                     booked days). The cached page carries a copy as of its last
//                     render; this replaces it the moment it arrives, so a slot
//                     someone else just took never looks free for longer than a
//                     page load. The order routes re-check seats regardless.
//
// One request per page, to /api/experiences/live/[providerId] (private, no-store).
// Until it lands the page reads as signed out, which is what the cached HTML
// shows too, so the first client render matches the server's.
//
// The owner/admin preview route renders the page per request and already knows
// all of this, so it passes `initial` and nothing is fetched.

import { createContext, useCallback, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import type { StayWindow } from '@/lib/packageNotice';
import type { MpSession, MpDeclaredSession } from '@/lib/experiencesData';
import type { PartialBlock } from '@/lib/serviceSlots';
import { PackageStaysProvider } from '@/components/marketplace/PackageNotice';
import StandaloneBookingPanel from '@/components/marketplace/StandaloneBookingPanel';
import BookingPanel from '@/components/marketplace/BookingPanel';
import FoodBasket from '@/components/marketplace/FoodBasket';

export interface ExperienceLiveAvailability {
    sessions: MpSession[];
    declaredSessions: MpDeclaredSession[];
    everScheduled: boolean;
    slotAvailability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
    slotBlocks: string[];
    partialBlocks: PartialBlock[];
    bookedDates: string[];
}

export interface ExperienceViewerState {
    signedIn: boolean;
    canReply: boolean;
    packageStays: StayWindow[];
    // Null until loaded, or when the provider is not live (paused) — the panel
    // then keeps the copy the page was rendered with.
    availability: ExperienceLiveAvailability | null;
}

interface Ctx extends ExperienceViewerState {
    providerId: string;
    // Ask the server to refresh this page's cached copy (after the provider
    // replies to a review). Owner/co-host only; a no-op for anyone else.
    refreshPage: () => Promise<void>;
}

const SIGNED_OUT: ExperienceViewerState = { signedIn: false, canReply: false, packageStays: [], availability: null };

const ViewerContext = createContext<Ctx | null>(null);

export function useExperienceViewer(): Ctx | null {
    return useContext(ViewerContext);
}

export function ExperienceViewerProvider({ providerId, initial, children }: {
    providerId: string;
    initial?: ExperienceViewerState;
    children: ReactNode;
}) {
    const [state, setState] = useState<ExperienceViewerState>(initial || SIGNED_OUT);
    const url = `/api/experiences/live/${providerId}`;

    useEffect(() => {
        if (initial) return;
        let live = true;
        const load = () => {
            fetch(url, { credentials: 'include', cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                    if (!live || !d || d.ok === false) return;
                    setState({
                        signedIn: d.signedIn === true,
                        canReply: d.canReply === true,
                        packageStays: Array.isArray(d.packageStays) ? d.packageStays : [],
                        availability: d.availability || null,
                    });
                })
                .catch(() => { /* keep what the page rendered with */ });
        };
        load();
        // Back to the tab after a while (or back to the page from the browser's
        // back/forward cache): fetch again, so seats and sign-in are current.
        const onVisible = () => { if (document.visibilityState === 'visible') load(); };
        const onShow = (e: PageTransitionEvent) => { if (e.persisted) load(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onShow);
        return () => {
            live = false;
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('pageshow', onShow);
        };
    }, [url, initial]);

    const refreshPage = useCallback(async () => {
        try { await fetch(url, { method: 'POST', credentials: 'include' }); } catch { /* best effort */ }
    }, [url]);

    return (
        <ViewerContext.Provider value={{ ...state, providerId, refreshPage }}>
            <PackageStaysProvider stays={state.packageStays}>{children}</PackageStaysProvider>
        </ViewerContext.Provider>
    );
}

// The provider props with the live calendar laid over the rendered copy.
function withLive<T extends object>(provider: T, v: Ctx | null): T {
    return v && v.availability ? { ...provider, ...v.availability } : provider;
}

// The three booking panels as the cached page uses them: signed-in state and the
// live calendar come from the viewer context rather than the server render.

type StandaloneProps = ComponentProps<typeof StandaloneBookingPanel>;
export function LiveStandaloneBookingPanel(props: Omit<StandaloneProps, 'signedIn'>) {
    const v = useExperienceViewer();
    return <StandaloneBookingPanel {...props} provider={withLive(props.provider, v)} signedIn={!!v?.signedIn} />;
}

type RequestProps = ComponentProps<typeof BookingPanel>;
export function LiveBookingPanel(props: Omit<RequestProps, 'signedIn'>) {
    const v = useExperienceViewer();
    return <BookingPanel {...props} provider={withLive(props.provider, v)} signedIn={!!v?.signedIn} />;
}

type BasketProps = ComponentProps<typeof FoodBasket>;
export function LiveFoodBasket(props: Omit<BasketProps, 'signedIn'>) {
    const v = useExperienceViewer();
    return <FoodBasket {...props} signedIn={!!v?.signedIn} />;
}

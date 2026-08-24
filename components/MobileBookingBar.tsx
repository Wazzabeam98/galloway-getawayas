'use client';

import { useEffect, useState } from 'react';

// Below lg the booking widget is one column among several, so before this it
// sat after the description, the amenities, the reviews and the map. A guest
// on a phone scrolled the whole page before finding a price.
//
// The widget itself has moved up to sit under the photos, and this bar carries
// the price the rest of the way down the page. It deliberately does not take a
// booking: there is one BookingWidget on the page and it owns the dates, the
// guest counts and the quote. A second Reserve button that talked to Stripe
// would be a second source of truth on the money path.
export default function MobileBookingBar({
    pricePerNight,
    label,
    targetId,
}: {
    pricePerNight: number;
    label: string;
    targetId: string;
}) {
    const [widgetOnScreen, setWidgetOnScreen] = useState(true);

    // Out of the way while the widget itself is visible — otherwise the bar
    // covers the thing it is pointing at.
    //
    // Measured from scroll position rather than with an IntersectionObserver.
    // The observer version was correct and I could not prove it: in the
    // preview pane no observer fires at all, including a fresh one created by
    // hand, so there was no way to watch the bar appear. A scroll listener is
    // duller and can be checked by reading numbers.
    useEffect(() => {
        let frame = 0;

        const measure = () => {
            frame = 0;
            const el = document.getElementById(targetId);
            if (!el) return;

            const box = el.getBoundingClientRect();
            const visible =
                Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0));

            // Showing at least a third of the widget counts as on screen.
            setWidgetOnScreen(box.height > 0 && visible / box.height >= 0.3);
        };

        const onScroll = () => {
            if (!frame) frame = window.requestAnimationFrame(measure);
        };

        measure();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, [targetId]);

    const goToWidget = () => {
        const el = document.getElementById(targetId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    return (
        <div
            className={`lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_12px_rgba(0,0,0,0.06)] transition-transform duration-200 ${
                widgetOnScreen ? 'translate-y-full' : 'translate-y-0'
            }`}
            aria-hidden={widgetOnScreen}
        >
            <div className="flex items-center justify-between gap-4">
                <p className="min-w-0">
                    <span className="text-lg font-bold text-slate-900">£{pricePerNight}</span>
                    <span className="text-sm text-slate-500"> / night</span>
                </p>
                <button
                    type="button"
                    onClick={goToWidget}
                    tabIndex={widgetOnScreen ? -1 : 0}
                    className="shrink-0 rounded-full bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                    {label}
                </button>
            </div>
        </div>
    );
}

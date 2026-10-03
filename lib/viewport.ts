// The page's viewport, chosen per device.
//
// iOS Safari zooms the whole page the instant a text field is tapped, and
// keeps that zoom for the rest of the visit. On Liam's iPhone 15 it did so
// through 16px and then 17px fields (03/10/2026), so iOS gets
// maximum-scale=1 + user-scalable=no, which stops it zooming on focus at
// all. Safari has ignored both for PINCHING since iOS 10, so iPhone users
// can still pinch-zoom; only the automatic zoom stops.
//
// Everyone else gets the plain viewport. Android browsers DO obey those two
// settings — sent to them, nobody on Android could pinch-zoom anywhere on the
// site — and Android never had the focus zoom to begin with.
//
// Matched on the user agent, server side, so it is right on the first paint
// with no script. "iPhone" / "iPod" / "iPad" covers Safari and every other
// iOS browser (Chrome on iOS is "CriOS", Firefox "FxiOS" — all WebKit, all
// zoom the same way). An iPad in its default desktop mode says "Macintosh"
// and gets the plain viewport; desktop-mode iPad Safari does not focus-zoom.

export type Viewport = {
    width: 'device-width';
    initialScale: 1;
    maximumScale?: 1;
    userScalable?: false;
};

export function isIOS(userAgent: string | null | undefined): boolean {
    return /\b(iPhone|iPod|iPad)\b/.test(userAgent || '');
}

export function viewportFor(userAgent: string | null | undefined): Viewport {
    if (isIOS(userAgent)) {
        return { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };
    }
    return { width: 'device-width', initialScale: 1 };
}

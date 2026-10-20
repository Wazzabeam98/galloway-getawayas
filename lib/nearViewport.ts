// Run `fn` once `el` is within `margin` of the viewport, and never before.
//
// The maps are the heaviest thing on the public pages: Mapbox GL is ~370 KB of
// script, and starting it pulls ~600 KB of tiles, sprites and fonts on top —
// and every start is a billed Mapbox map load. On the home page, a listing and
// an area page the map sits well below the fold, so a visitor who never
// scrolls to it was paying all of that (on a phone, on mobile data) for
// nothing, and it was competing with the photos for the first paint. Waiting
// until the map is about to come into view costs a scroller nothing — the
// margin starts it a screen early — and costs a non-scroller nothing at all.
//
// A map that is already on screen (the phone's full-screen map, a map at the
// top of a page) intersects on the first callback, so it starts immediately.
// Returns a cancel function for the effect's cleanup.
export function whenNearViewport(el: Element, fn: () => void, margin = '600px'): () => void {
    if (typeof IntersectionObserver === 'undefined') {
        fn();
        return () => {};
    }
    let done = false;
    const io = new IntersectionObserver((entries) => {
        if (done || !entries.some((e) => e.isIntersecting)) return;
        done = true;
        io.disconnect();
        fn();
    }, { rootMargin: margin });
    io.observe(el);
    return () => { done = true; io.disconnect(); };
}

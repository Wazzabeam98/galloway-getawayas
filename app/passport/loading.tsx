import { GooseMark } from "@/components/base/Logo";

// The same lighter loading state the other signed-in areas use.
//
// There is no longer a root app/loading.tsx to fall back to: a loading file at
// the root wrapped EVERY page in a Suspense boundary, which made Next flush
// the HTML shell — and a 200 status — before a page had finished deciding
// whether it existed. notFound() after that point rendered the not-found page
// under a 200, so every dead listing URL was a soft 404. See SITE-AUDIT.md.
export default function Loading() {
    return (
        <div className="max-w-7xl mx-auto px-6 py-24 flex flex-col items-center">
            <GooseMark className="w-12 h-auto text-emerald-700 animate-pulse" />
            <p className="mt-4 text-sm text-slate-500">Loading…</p>
        </div>
    );
}

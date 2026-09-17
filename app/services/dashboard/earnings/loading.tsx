import { GooseMark } from "@/components/base/Logo";

// A light loading state, the same as the cottage earnings page — a provider
// moving between their own pages needs a sign something is happening, not the
// whole brand again.
export default function Loading() {
    return (
        <div className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center">
            <GooseMark className="w-12 h-auto text-emerald-700 animate-pulse" />
            <p className="mt-4 text-sm text-slate-500">Loading…</p>
        </div>
    );
}

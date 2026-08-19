import { GooseMark } from "@/components/base/Logo";

// A lighter loading state than the full-screen one on the guest side — a host
// moving between their own pages doesn't need the whole brand again, just a
// sign that something is happening.
export default function Loading() {
    return (
        <div className="max-w-7xl mx-auto px-6 py-24 flex flex-col items-center">
            <GooseMark className="w-12 h-auto text-emerald-700 animate-pulse" />
            <p className="mt-4 text-sm text-slate-500">Loading…</p>
        </div>
    );
}

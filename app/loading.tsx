import React from "react";

export default function Loading() {
    return (
        <div className="w-screen h-screen flex justify-center items-center flex-col bg-white">
            {/* Galloway Getaways badge */}
            <div className="relative flex items-center justify-center w-24 h-24 rounded-3xl bg-emerald-950 shadow-lg border border-emerald-900 animate-pulse">
                <span className="text-emerald-400 font-serif font-black text-5xl tracking-tighter select-none -mr-2">
                    G
                </span>
                <span className="text-emerald-200 font-serif font-black text-5xl tracking-tighter select-none opacity-70">
                    G
                </span>
            </div>

            <div className="flex flex-col items-center mt-6">
                <span className="text-3xl font-extrabold tracking-tight text-stone-900 leading-none">
                    Galloway
                </span>
                <span className="text-xs font-semibold tracking-[0.3em] text-emerald-700 uppercase mt-1.5">
                    Getaways
                </span>
            </div>

            <p className="mt-8 text-stone-500">
                Finding your perfect getaway...
            </p>
        </div>
    );
}

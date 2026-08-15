import React from "react";
import { GooseMark } from "@/components/base/Logo";

export default function Loading() {
    return (
        <div className="w-screen h-screen flex justify-center items-center flex-col bg-white">
            <GooseMark className="w-24 h-auto text-emerald-700 animate-pulse" />

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

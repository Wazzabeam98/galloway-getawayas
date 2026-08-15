"use client"

import React from 'react';
import { Home } from 'lucide-react';

// Shows roughly where a property is, without giving away the exact door.
//
// The pin marks a point deliberately shifted a short distance from the
// real address, so a guest can see which street and what's nearby, but
// nobody can work out precisely which house is empty next week.
export default function PropertyMap({
    latitude,
    longitude,
    area,
}: {
    latitude: number;
    longitude: number;
    area?: string;
}) {
    // A fixed offset derived from the coordinates themselves, so the same
    // property always shows the same pin rather than shifting on every
    // page load — otherwise repeated reloads would give the real spot away.
    const seed = Math.abs(Math.sin(latitude * 1000 + longitude * 1000));
    const offsetLat = (seed - 0.5) * 0.0011;      // roughly 60m
    const offsetLon = (seed - 0.5) * 0.0018;

    const centreLat = latitude + offsetLat;
    const centreLon = longitude + offsetLon;

    // Tighter box than before — about a 350m view, so street names read
    // clearly and nearby places are recognisable.
    const padLon = 0.0032;
    const padLat = 0.0016;
    const bbox = [
        centreLon - padLon,
        centreLat - padLat,
        centreLon + padLon,
        centreLat + padLat,
    ].join(',');

    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;

    return (
        <div className="mt-8 pt-8 border-t">
            <h2 className="text-xl font-semibold mb-1">Where you&apos;ll be</h2>
            <p className="text-sm text-slate-500 mb-4">
                {area ? `${area}. ` : ''}The exact address is shared once your booking is confirmed.
            </p>

            <div className="relative rounded-2xl overflow-hidden border">
                <iframe
                    title="Approximate location"
                    src={src}
                    className="w-full h-[280px] md:h-[380px] border-0"
                    loading="lazy"
                />

                {/* Approximate location pin, centred on the map */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="relative">
                        <span className="absolute inset-0 -m-3 rounded-full bg-emerald-600/15" />
                        <span className="w-12 h-12 rounded-full bg-slate-900 shadow-lg flex items-center justify-center relative">
                            <Home className="w-5 h-5 text-white" strokeWidth={2} />
                        </span>
                    </div>
                </div>
            </div>

            <p className="text-xs text-slate-400 mt-2">
                Map data from OpenStreetMap contributors. The pin shows the approximate area,
                not the exact property.
            </p>
        </div>
    );
}

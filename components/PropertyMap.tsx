"use client"

import React from 'react';

// Shows roughly where a property is, without giving away the exact door.
//
// The map is centred on a point deliberately shifted a short distance from
// the real one, with no marker, and a translucent circle drawn over the
// middle. A guest can see the street and what's nearby; nobody can work
// out which house is empty next week.
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
    // property always shows the same circle rather than jumping about on
    // every page load.
    const seed = Math.abs(Math.sin(latitude * 1000 + longitude * 1000));
    const offsetLat = (seed - 0.5) * 0.0016;      // roughly 90m
    const offsetLon = (seed - 0.5) * 0.0026;

    const centreLat = latitude + offsetLat;
    const centreLon = longitude + offsetLon;

    // Box around the centre point — about a 600m view.
    const pad = 0.006;
    const bbox = [
        centreLon - pad,
        centreLat - pad / 2,
        centreLon + pad,
        centreLat + pad / 2,
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
                    className="w-full h-[280px] md:h-[360px] border-0"
                    loading="lazy"
                />

                {/* Approximate-area circle, centred on the map */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-40 md:w-52 md:h-52 rounded-full bg-emerald-600/20 border-2 border-emerald-700/60" />
                </div>
            </div>

            <p className="text-xs text-slate-400 mt-2">
                Map data from OpenStreetMap contributors. The circle shows the general area,
                not the property itself.
            </p>
        </div>
    );
}

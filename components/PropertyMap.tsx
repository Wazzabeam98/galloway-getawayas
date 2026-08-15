"use client"

import React, { useEffect, useRef } from 'react';

// Shows roughly where a property is, without giving away the exact door.
//
// Uses Leaflet with OpenStreetMap tiles, loaded from a CDN so there's no
// package to install. The marker is anchored to real coordinates, so it
// stays on its street when the guest pans or zooms.
export default function PropertyMap({
    latitude,
    longitude,
    area,
}: {
    latitude: number;
    longitude: number;
    area?: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);

    // A fixed offset derived from the coordinates themselves, so the same
    // property always shows the same spot rather than shifting on every
    // page load — otherwise repeated reloads would give the real one away.
    const seed = Math.abs(Math.sin(latitude * 1000 + longitude * 1000));
    const pinLat = latitude + (seed - 0.5) * 0.0011;   // roughly 60m
    const pinLon = longitude + (seed - 0.5) * 0.0018;

    useEffect(() => {
        let cancelled = false;

        const loadCss = () => {
            if (document.getElementById('leaflet-css')) return;
            const link = document.createElement('link');
            link.id = 'leaflet-css';
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
            document.head.appendChild(link);
        };

        const loadScript = () =>
            new Promise<void>((resolve, reject) => {
                if ((window as any).L) return resolve();

                const existing = document.getElementById('leaflet-js');
                if (existing) {
                    existing.addEventListener('load', () => resolve());
                    existing.addEventListener('error', () => reject());
                    return;
                }

                const script = document.createElement('script');
                script.id = 'leaflet-js';
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
                script.onload = () => resolve();
                script.onerror = () => reject();
                document.body.appendChild(script);
            });

        const build = async () => {
            loadCss();

            try {
                await loadScript();
            } catch (err) {
                console.error('Map library could not be loaded:', err);
                return;
            }

            if (cancelled || !containerRef.current || mapRef.current) return;

            const L = (window as any).L;
            if (!L) return;

            const map = L.map(containerRef.current, {
                center: [pinLat, pinLon],
                zoom: 16,
                scrollWheelZoom: false,
            });
            mapRef.current = map;

            // CARTO's Voyager style — same OpenStreetMap data, but a far
            // cleaner look than the default tiles. Free, no API key.
            // For a plainer, near-greyscale map, swap 'rastertiles/voyager'
            // for 'light_all' below.
            L.tileLayer(
                'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
                {
                    maxZoom: 19,
                    subdomains: 'abcd',
                    detectRetina: true,
                    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
                }
            ).addTo(map);

            // A house in a dark circle, matching the site rather than
            // Leaflet's default blue teardrop.
            const icon = L.divIcon({
                className: '',
                html:
                    '<div style="width:48px;height:48px;border-radius:9999px;background:#0f172a;' +
                    'box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;' +
                    'justify-content:center;">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" ' +
                    'fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" ' +
                    'stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
                    '<polyline points="9 22 9 12 15 12 15 22"/></svg>' +
                    '</div>',
                iconSize: [48, 48],
                iconAnchor: [24, 24],
            });

            L.marker([pinLat, pinLon], { icon, interactive: false }).addTo(map);
        };

        build();

        return () => {
            cancelled = true;
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [pinLat, pinLon]);

    return (
        <div className="mt-8 pt-8 border-t">
            <h2 className="text-xl font-semibold mb-1">Where you&apos;ll be</h2>
            <p className="text-sm text-slate-500 mb-4">
                {area ? `${area}. ` : ''}The exact address is shared once your booking is confirmed.
            </p>

            <div
                ref={containerRef}
                className="w-full h-[280px] md:h-[380px] rounded-2xl overflow-hidden border bg-slate-100 z-0"
            />

            <p className="text-xs text-slate-400 mt-2">
                Map data from OpenStreetMap contributors, tiles by CARTO. The pin shows the
                approximate area, not the exact property.
            </p>
        </div>
    );
}

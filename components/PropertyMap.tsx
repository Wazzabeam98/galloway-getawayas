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
    variant = 'full',
}: {
    latitude: number;
    longitude: number;
    area?: string;
    // 'full' is the listing-page block (heading, big frame, a house marker on
    // the approximate spot). 'card' is a small, chromeless AREA map for the
    // trip card: no marker at all and zoomed out to a town scale, so it reads
    // as "roughly here" — a sense of place, not navigation (Get directions does
    // that) and never a pin on the door.
    variant?: 'full' | 'card';
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const roRef = useRef<any>(null);
    const isCard = variant === 'card';

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
                center: isCard ? [latitude, longitude] : [pinLat, pinLon],
                // Street scale either way. The card now shows a house PIN at the
                // property (Airbnb-style), so it sits close in; the full listing
                // block keeps its slightly-fuzzed marker.
                zoom: isCard ? 15 : 16,
                scrollWheelZoom: false,
                zoomControl: !isCard,
            });
            mapRef.current = map;

            // Plain OpenStreetMap tiles — free and keyless. CARTO's basemaps now
            // require an API key and render an "API KEY REQUIRED" watermark on
            // every tile without one, which is what this replaced.
            L.tileLayer(
                'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                {
                    maxZoom: 19,
                    subdomains: 'abc',
                    detectRetina: true,
                    attribution: '&copy; OpenStreetMap contributors',
                }
            ).addTo(map);

            // A house in a dark circle, matching the site rather than Leaflet's
            // default blue teardrop.
            const icon = L.divIcon({
                className: '',
                html:
                    '<div style="width:44px;height:44px;border-radius:9999px;background:#0f172a;' +
                    'box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;' +
                    'justify-content:center;">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" ' +
                    'fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" ' +
                    'stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
                    '<polyline points="9 22 9 12 15 12 15 22"/></svg>' +
                    '</div>',
                iconSize: [44, 44],
                iconAnchor: [22, 22],
            });
            // The card pins the actual property; the full block uses the fuzzed
            // point for pre-booking privacy.
            L.marker(isCard ? [latitude, longitude] : [pinLat, pinLon], { icon, interactive: false }).addTo(map);

            if (isCard) {
                // The rectangle can lay out AFTER Leaflet first reads its size,
                // which leaves tiles grey or half-drawn; recompute the size once it
                // has settled and on any later resize. Keep the pin centred.
                const frame = () => {
                    if (!mapRef.current) return;
                    map.invalidateSize();
                    map.setView([latitude, longitude], 15);
                };
                setTimeout(frame, 80);
                if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
                    const ro = new ResizeObserver(() => frame());
                    ro.observe(containerRef.current);
                    roRef.current = ro;
                }
            }
        };

        build();

        return () => {
            cancelled = true;
            if (roRef.current) {
                roRef.current.disconnect();
                roRef.current = null;
            }
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [pinLat, pinLon]);

    if (isCard) {
        return (
            <div className="overflow-hidden rounded-xl border border-slate-200">
                <div ref={containerRef} className="aspect-[16/9] w-full bg-slate-100 z-0" />
                {area && (
                    <div className="bg-white px-3.5 py-2 text-xs text-slate-500">{area}</div>
                )}
            </div>
        );
    }

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
                Map data and tiles from OpenStreetMap contributors. The pin shows the
                approximate area, not the exact property.
            </p>
        </div>
    );
}

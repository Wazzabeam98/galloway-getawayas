"use client"

import React, { useEffect, useRef } from 'react';

// Shows roughly where a property is, without giving away the exact door.
//
// Uses Mapbox GL JS, loaded from Mapbox's CDN so there's no package to install
// (the same shape the Leaflet version used before). The token is a public one,
// read in the browser, so it lives in NEXT_PUBLIC_MAPBOX_TOKEN. It is
// unrestricted for now — before we open to real traffic it needs URL
// restrictions in Mapbox, which is a launch task, not a code one.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_VERSION = 'v3.7.0';
// Streets, not the minimal light style: this map is here to give a sense of
// place — roads, the coastline, a village name — so streets earns its keep.
const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

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
    // trip card: no controls, a house pin at the real property and a town-scale
    // zoom, so it reads as "roughly here" — a sense of place, not navigation
    // (Get directions does that).
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

    // The full listing block sits on the FUZZED point pre-booking; the trip
    // card, shown only to a guest who has already booked, sits on the real one.
    const centreLat = isCard ? latitude : pinLat;
    const centreLon = isCard ? longitude : pinLon;

    useEffect(() => {
        if (!MAPBOX_TOKEN) return;   // graceful: the frame stays, no map draws
        let cancelled = false;

        const loadCss = () => {
            if (document.getElementById('mapbox-css')) return;
            const link = document.createElement('link');
            link.id = 'mapbox-css';
            link.rel = 'stylesheet';
            link.href = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css`;
            document.head.appendChild(link);
        };

        const loadScript = () =>
            new Promise<void>((resolve, reject) => {
                if ((window as any).mapboxgl) return resolve();

                const existing = document.getElementById('mapbox-js');
                if (existing) {
                    existing.addEventListener('load', () => resolve());
                    existing.addEventListener('error', () => reject());
                    return;
                }

                const script = document.createElement('script');
                script.id = 'mapbox-js';
                script.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
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

            const mapboxgl = (window as any).mapboxgl;
            if (!mapboxgl) return;
            mapboxgl.accessToken = MAPBOX_TOKEN;

            const map = new mapboxgl.Map({
                container: containerRef.current,
                style: MAPBOX_STYLE,
                center: [centreLon, centreLat],   // Mapbox is [lng, lat]
                // The full block keeps a street-ish scale but CAPS how far in a
                // guest can go: the pin is already fuzzed by ~60m, and the cap
                // stops anyone zooming to rooftop level to second-guess it. The
                // map still pans and zooms out — it isn't frozen. The card,
                // shown post-booking, sits at a settled town scale.
                zoom: isCard ? 15 : 15,
                minZoom: isCard ? 13 : 11,
                maxZoom: isCard ? 17 : 16,
                // A plain north-up map; rotating it adds nothing here.
                dragRotate: false,
                pitchWithRotate: false,
                touchPitch: false,
                // Don't swallow the page's scroll — zoom is via the +/- control,
                // double-click and pinch instead.
                scrollZoom: false,
                // The card is a look, not a tool: no dragging or zooming at all.
                interactive: !isCard,
                attributionControl: true,
            });
            mapRef.current = map;

            if (!isCard) {
                map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
            }

            // A house in a dark circle, matching the site rather than Mapbox's
            // default marker — built as a DOM element and handed to Mapbox's own
            // Marker, so it tracks the coordinate natively as the guest pans.
            const el = document.createElement('div');
            el.style.cssText =
                'width:44px;height:44px;border-radius:9999px;background:#0f172a;' +
                'box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;';
            el.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" ' +
                'fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" ' +
                'stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
                '<polyline points="9 22 9 12 15 12 15 22"/></svg>';
            new mapboxgl.Marker({ element: el, anchor: 'center' })
                .setLngLat([centreLon, centreLat])
                .addTo(map);

            if (isCard) {
                // The rectangle can lay out AFTER Mapbox first reads its size,
                // which leaves it half-drawn; recompute once it has settled and
                // on any later resize, keeping the pin centred.
                const frame = () => {
                    if (!mapRef.current) return;
                    map.resize();
                    map.setCenter([longitude, latitude]);
                };
                map.on('load', frame);
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
    }, [centreLat, centreLon, latitude, longitude, isCard]);

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
                Map data &copy; Mapbox &copy; OpenStreetMap. The pin shows the
                approximate area, not the exact property.
            </p>
        </div>
    );
}

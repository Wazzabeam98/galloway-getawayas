'use client';

import React, { useEffect, useRef } from 'react';

// A single map with a pin for every trip on the "Your trips" page. Same Mapbox
// GL load and streets style as PropertyMap (loaded from Mapbox's CDN, no npm
// package), so it matches the rest of the site; the only difference is that this
// one plots many points and fits the view to them. In our own branding: an
// emerald bubble with the trip's photo, or a plain emerald pin when there's none.

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_VERSION = 'v3.7.0';
const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

export interface TripPoint {
    lat: number;
    lng: number;
    label: string;
    image?: string | null;
}

export default function TripsMap({ points, className = 'h-[320px] lg:h-[70vh]' }: { points: TripPoint[]; className?: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);

    useEffect(() => {
        if (!MAPBOX_TOKEN || !points.length) return;
        let cancelled = false;

        const loadCss = () => {
            if (document.getElementById('mapbox-css')) return;
            const link = document.createElement('link');
            link.id = 'mapbox-css';
            link.rel = 'stylesheet';
            link.href = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css`;
            document.head.appendChild(link);
        };
        const loadScript = () => new Promise<void>((resolve, reject) => {
            if ((window as any).mapboxgl) return resolve();
            const existing = document.getElementById('mapbox-js');
            if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject()); return; }
            const script = document.createElement('script');
            script.id = 'mapbox-js';
            script.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
            script.onload = () => resolve();
            script.onerror = () => reject();
            document.body.appendChild(script);
        });

        const build = async () => {
            loadCss();
            try { await loadScript(); } catch (err) { console.error('Map library could not be loaded:', err); return; }
            if (cancelled || !containerRef.current || mapRef.current) return;
            const mapboxgl = (window as any).mapboxgl;
            if (!mapboxgl) return;
            mapboxgl.accessToken = MAPBOX_TOKEN;

            const map = new mapboxgl.Map({
                container: containerRef.current,
                style: MAPBOX_STYLE,
                center: [points[0].lng, points[0].lat],
                zoom: 9,
                dragRotate: false, pitchWithRotate: false, touchPitch: false,
                attributionControl: true,
            });
            mapRef.current = map;
            map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

            for (const p of points) {
                const el = document.createElement('div');
                if (p.image) {
                    el.style.cssText = 'width:42px;height:42px;border-radius:12px;background-color:#047857;box-shadow:0 4px 12px rgba(0,0,0,0.3);padding:3px;box-sizing:border-box;';
                    const inner = document.createElement('div');
                    inner.style.cssText = 'width:100%;height:100%;border-radius:9px;background-color:#e2e8f0;background-size:cover;background-position:center;';
                    inner.style.backgroundImage = `url("${String(p.image).replace(/"/g, '\\"')}")`;
                    el.appendChild(inner);
                } else {
                    el.style.cssText = 'width:40px;height:40px;border-radius:9999px;background:#047857;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;';
                    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
                }
                const popup = new mapboxgl.Popup({ offset: 24, closeButton: false }).setText(p.label);
                new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
            }

            const fit = () => {
                if (!mapRef.current) return;
                map.resize();
                if (points.length === 1) { map.setCenter([points[0].lng, points[0].lat]); map.setZoom(11); return; }
                const b = new mapboxgl.LngLatBounds();
                for (const p of points) b.extend([p.lng, p.lat]);
                map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
            };
            map.on('load', fit);
            setTimeout(fit, 120);
        };

        build();
        return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    }, [points]);

    if (!MAPBOX_TOKEN || !points.length) {
        return <div className={`w-full ${className} rounded-2xl border border-slate-200 bg-slate-100`} />;
    }
    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div ref={containerRef} className={`w-full ${className} bg-slate-100 z-0`} />
        </div>
    );
}

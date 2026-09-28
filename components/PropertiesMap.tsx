"use client"

import React, { useEffect, useRef } from 'react';

// A small overview map with a house pin for several properties at once — the
// dashboard sibling of PropertyMap (which shows one property on the public
// listing page). Same Mapbox style and the same house-in-a-dark-circle marker,
// so the two read as one map, but this one plots a whole portfolio and frames
// itself to fit them all.
//
// Privacy: it is fed the STREET-LEVEL approximate coordinates only
// (listings.approx_latitude / approx_longitude, rounded to ~110m), never the
// exact pair — the caller passes those in and the exact columns are not read on
// these pages at all. maxZoom is capped so nobody can zoom a lone pin to
// rooftop level and second-guess it.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_VERSION = 'v3.7.0';
const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

export interface MapPoint {
    id: string;
    lat: number;
    lng: number;
    title: string;
    href?: string;
}

export default function PropertiesMap({
    points,
    frameClassName = 'h-[360px] lg:h-[calc(100vh-9rem)]',
}: {
    points: MapPoint[];
    frameClassName?: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);

    useEffect(() => {
        if (!MAPBOX_TOKEN) return;   // graceful: the frame stays, no map draws
        if (!points.length) return;
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

        const houseEl = () => {
            const el = document.createElement('div');
            el.style.cssText =
                'width:36px;height:36px;border-radius:9999px;background:#0f172a;cursor:pointer;' +
                'box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;';
            el.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" ' +
                'fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" ' +
                'stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
                '<polyline points="9 22 9 12 15 12 15 22"/></svg>';
            return el;
        };

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
                center: [points[0].lng, points[0].lat],
                zoom: 10,
                minZoom: 6,
                // Street scale at most: the pins are already coarsened to ~110m,
                // and this stops a single-property portfolio zooming to rooftop.
                maxZoom: 14,
                dragRotate: false,
                pitchWithRotate: false,
                touchPitch: false,
                scrollZoom: false,
                attributionControl: true,
            });
            mapRef.current = map;
            map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

            const bounds = new mapboxgl.LngLatBounds();
            points.forEach((p) => {
                const el = houseEl();
                const popup = new mapboxgl.Popup({ offset: 22, closeButton: false })
                    .setText(p.title);
                const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([p.lng, p.lat])
                    .setPopup(popup)
                    .addTo(map);
                el.addEventListener('mouseenter', () => marker.togglePopup());
                el.addEventListener('mouseleave', () => marker.togglePopup());
                if (p.href) {
                    el.addEventListener('click', () => { window.location.href = p.href!; });
                }
                bounds.extend([p.lng, p.lat]);
            });

            const settle = () => {
                if (!mapRef.current) return;
                map.resize();
                if (points.length === 1) {
                    map.setCenter([points[0].lng, points[0].lat]);
                    map.setZoom(12);
                } else {
                    map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 0 });
                }
            };
            map.on('load', settle);
            setTimeout(settle, 80);
            if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
                const ro = new ResizeObserver(() => settle());
                ro.observe(containerRef.current);
            }
        };

        build();

        return () => {
            cancelled = true;
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [points]);

    if (!points.length) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                No properties to map yet.
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div ref={containerRef} className={`${frameClassName} w-full bg-slate-100 z-0`} />
        </div>
    );
}

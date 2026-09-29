"use client"

import React, { useEffect, useRef } from 'react';

// The search map — Airbnb's shape. A white price pill for every live property,
// a mini card (photo, title, price) on click that links to the listing, and a
// highlight when the matching card is hovered. Used on the town pages beside the
// results and, full width, under the home-page grid.
//
// Privacy is the same as the single-property map: it is fed the STREET-LEVEL
// approx_latitude/approx_longitude (~110m rounded) only, never the exact pair,
// and maxZoom is capped so no pin can be zoomed to an exact house.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_VERSION = 'v3.7.0';
const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

export interface PriceMapPoint {
    id: string;
    title: string;
    price: number | string;
    image: string | null;
    area: string | null;
    lat: number;
    lng: number;
    href: string;
}

function pillHtml(price: number | string): string {
    return `£${price}`;
}

function cardHtml(p: PriceMapPoint): string {
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const img = p.image
        ? `<img src="${esc(p.image)}" alt="" style="width:100%;height:124px;object-fit:cover;display:block;" />`
        : `<div style="width:100%;height:124px;background:#e2e8f0;"></div>`;
    return (
        `<a href="${esc(p.href)}" style="display:block;width:200px;text-decoration:none;color:inherit;">`
        + img
        + `<div style="padding:9px 11px 11px;">`
        + `<div style="font-weight:600;font-size:14px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.title)}</div>`
        + (p.area ? `<div style="font-size:12px;color:#64748b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.area)}</div>` : '')
        + `<div style="font-size:13px;color:#0f172a;margin-top:4px;"><span style="font-weight:700;">£${esc(String(p.price))}</span> <span style="color:#64748b;">night</span></div>`
        + `</div></a>`
    );
}

export default function PriceMap({
    points,
    highlightId = null,
    onHover,
    frameClassName = 'h-[420px]',
}: {
    points: PriceMapPoint[];
    highlightId?: string | null;
    onHover?: (id: string | null) => void;
    frameClassName?: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const elsRef = useRef<Record<string, HTMLElement>>({});

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
        const loadScript = () =>
            new Promise<void>((resolve, reject) => {
                if ((window as any).mapboxgl) return resolve();
                const existing = document.getElementById('mapbox-js');
                if (existing) {
                    existing.addEventListener('load', () => resolve());
                    existing.addEventListener('error', () => reject());
                    return;
                }
                const s = document.createElement('script');
                s.id = 'mapbox-js';
                s.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
                s.onload = () => resolve();
                s.onerror = () => reject();
                document.body.appendChild(s);
            });

        const build = async () => {
            loadCss();
            try { await loadScript(); } catch { return; }
            if (cancelled || !containerRef.current || mapRef.current) return;

            const mapboxgl = (window as any).mapboxgl;
            if (!mapboxgl) return;
            mapboxgl.accessToken = MAPBOX_TOKEN;

            const map = new mapboxgl.Map({
                container: containerRef.current,
                style: MAPBOX_STYLE,
                center: [points[0].lng, points[0].lat],
                zoom: 9,
                minZoom: 6,
                // Street scale at most — the pins are ~110m rounded, and this stops
                // anyone zooming a lone pin to rooftop level.
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
                const el = document.createElement('div');
                el.className = 'pricemap-pill';
                el.textContent = pillHtml(p.price);
                elsRef.current[p.id] = el;

                const popup = new mapboxgl.Popup({ offset: 18, closeButton: true, className: 'pricemap-popup', maxWidth: '220px' })
                    .setHTML(cardHtml(p));
                const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([p.lng, p.lat])
                    .setPopup(popup)
                    .addTo(map);

                el.addEventListener('mouseenter', () => { onHover && onHover(p.id); });
                el.addEventListener('mouseleave', () => { onHover && onHover(null); });
                // A pill that is a marker swallows the map click, so wire the popup
                // open explicitly rather than relying on the default toggle.
                el.addEventListener('click', (e) => { e.stopPropagation(); marker.togglePopup(); });
                bounds.extend([p.lng, p.lat]);
            });

            const settle = () => {
                if (!mapRef.current) return;
                map.resize();
                if (points.length === 1) {
                    map.setCenter([points[0].lng, points[0].lat]);
                    map.setZoom(12);
                } else {
                    map.fitBounds(bounds, { padding: 64, maxZoom: 13, duration: 0 });
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
            if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
            elsRef.current = {};
        };
    }, [points, onHover]);

    // Highlight the pin whose card is hovered (and lift it above its neighbours).
    useEffect(() => {
        Object.entries(elsRef.current).forEach(([id, el]) => {
            const on = id === highlightId;
            el.classList.toggle('is-active', on);
            el.style.zIndex = on ? '5' : '';
        });
    }, [highlightId]);

    if (!MAPBOX_TOKEN) {
        return (
            <div className={`${frameClassName} w-full rounded-2xl border border-slate-200 bg-slate-100`} />
        );
    }
    if (!points.length) {
        return (
            <div className={`${frameClassName} w-full rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500`}>
                Nothing to map here yet.
            </div>
        );
    }

    return (
        <div className={`overflow-hidden rounded-2xl border border-slate-200 ${frameClassName}`}>
            {/* The height lives on the wrapper (above), so an inner h-full works
                whether the caller passes a fixed height or, on the phone's
                full-screen map, h-full off a fixed-inset parent. */}
            <div ref={containerRef} className="h-full w-full bg-slate-100 z-0" />
        </div>
    );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { BedDouble, ChevronLeft, ChevronRight } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
import { normaliseArrangements, bedSummary, roomLabel, type Room } from '@/lib/sleeping';

// "Where you'll sleep" — Airbnb's sideways carousel of large room cards: a photo
// of the room (chosen by the host from the listing's own photos, with the bed
// icon as a fallback) above the room name and its beds, two cards visible on a
// desktop, one on a phone, with a "1 / N" counter and arrows.
//
// Renders nothing until a room has beds, so an older listing doesn't grow an
// empty section.
export default function WhereYoullSleep({ arrangements }: { arrangements: any }) {
    const rooms: Room[] = normaliseArrangements(arrangements).filter(
        (r) => r.beds.some((b) => b.count > 0)
    );

    const scrollerRef = useRef<HTMLDivElement>(null);
    const [index, setIndex] = useState(0);

    // Step the carousel by one card. Card width is measured from the first card
    // so the maths holds at either breakpoint without hard-coding a width.
    const step = (dir: -1 | 1) => {
        const el = scrollerRef.current;
        if (!el) return;
        const card = el.querySelector('[data-room-card]') as HTMLElement | null;
        const gap = 16;
        const by = (card ? card.offsetWidth : el.clientWidth) + gap;
        el.scrollBy({ left: dir * by, behavior: 'smooth' });
    };

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const onScroll = () => {
            const card = el.querySelector('[data-room-card]') as HTMLElement | null;
            const gap = 16;
            const w = (card ? card.offsetWidth : el.clientWidth) + gap;
            setIndex(Math.round(el.scrollLeft / w));
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [rooms.length]);

    if (rooms.length === 0) return null;

    let bedroomSeen = 0;
    const multiple = rooms.length > 1;

    return (
        <section id="sleeping" className="mt-8 pt-8 border-t scroll-mt-24">
            <div className="flex items-end justify-between gap-4">
                <h2 className="text-xl font-semibold text-slate-900">Where you&apos;ll sleep</h2>
                {multiple && (
                    <div className="hidden sm:flex items-center gap-3">
                        <span className="text-sm text-slate-500 tabular-nums">
                            {Math.min(index + 1, rooms.length)} / {rooms.length}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => step(-1)}
                                disabled={index <= 0}
                                aria-label="Previous room"
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:border-slate-900 disabled:opacity-30 disabled:hover:border-slate-300"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => step(1)}
                                disabled={index >= rooms.length - 1}
                                aria-label="Next room"
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:border-slate-900 disabled:opacity-30 disabled:hover:border-slate-300"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div
                ref={scrollerRef}
                className="mt-4 flex gap-4 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
                {rooms.map((room, i) => {
                    if (room.kind === 'bedroom') bedroomSeen += 1;
                    return (
                        <div
                            key={i}
                            data-room-card
                            className="snap-start shrink-0 basis-[82%] sm:basis-[calc(50%-0.5rem)]"
                        >
                            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                                {room.photo ? (
                                    <Image
                                        src={getImageUrl(room.photo)}
                                        alt={roomLabel(room, bedroomSeen)}
                                        fill
                                        sizes="(max-width: 640px) 82vw, 40vw"
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                        <BedDouble className="h-10 w-10 text-slate-400" strokeWidth={1.5} />
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 font-semibold text-slate-900">
                                {roomLabel(room, bedroomSeen)}
                            </div>
                            <div className="mt-0.5 text-sm text-slate-500">{bedSummary(room.beds)}</div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

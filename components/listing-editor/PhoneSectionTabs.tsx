'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The listing editor on a phone is one continuous page (every section's cards
// in order); this is the bar that finds your way round it. It sticks just
// below the site header, the tab for the section you're in is the active one
// (dark, with a short brand-green underline that slides to it), and the row
// scrolls sideways by itself to keep that tab in view. Tapping a tab scrolls
// the page to that section's heading, landing just below the bar.
//
// Phone only: the page renders it when the left-hand list isn't there.
// Each section on the page is a block with data-editor-section="<key>".

const HEADER_H = 81; // the site nav: h-20 plus its 1px border
const BAR_H = 48; // h-12 — every tab is at least 48px tall
const GAP = 16; // a heading lands this far below the bar

// Anywhere else on the page (the "Add the address" prompt) can send the host
// to a section the same way a tab tap does.
const EVENT = 'gg:editor-section';
export function goToEditorSection(key: string) {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key } }));
}

function sectionEl(key: string) {
    return document.querySelector<HTMLElement>(`[data-editor-section="${key}"]`);
}

export default function PhoneSectionTabs({ sections, initial }: {
    sections: { key: string; label: string }[];
    // From ?section= — the page opens already at that section.
    initial?: string;
}) {
    const [active, setActive] = useState(initial && sections.some((s) => s.key === initial) ? initial : sections[0].key);
    const [stuck, setStuck] = useState(false);
    const [line, setLine] = useState<{ left: number; width: number } | null>(null);

    const sentinelRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const labelRefs = useRef<Record<string, HTMLSpanElement | null>>({});
    // While a tap's smooth scroll runs, the tapped tab holds — otherwise the
    // underline would flick through every section the page passes on the way.
    const heading = useRef<string | null>(null);
    const settle = useRef<number | undefined>(undefined);

    const scrollPageTo = (key: string, smooth: boolean) => {
        const el = sectionEl(key);
        if (!el) return;
        heading.current = key;
        setActive(key);
        const top = el.getBoundingClientRect().top + window.scrollY - HEADER_H - BAR_H - GAP;
        window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
        // A scroll that has nowhere to go fires no events; let go anyway.
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => { heading.current = null; }, 600);
    };

    // Which section is the host in, and is the bar stuck?
    useEffect(() => {
        let raf = 0;
        const update = () => {
            raf = 0;
            const s = sentinelRef.current;
            if (s) setStuck(s.getBoundingClientRect().top < HEADER_H);
            if (heading.current) {
                // Still travelling to a tapped section: hold it until the
                // scroll has been quiet for a moment.
                window.clearTimeout(settle.current);
                settle.current = window.setTimeout(() => { heading.current = null; }, 150);
                return;
            }
            const line = HEADER_H + BAR_H + GAP + 8;
            let current = sections[0].key;
            for (const { key } of sections) {
                const el = sectionEl(key);
                if (el && el.getBoundingClientRect().top <= line) current = key;
            }
            // At the very bottom a short last section can never reach the bar.
            const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
            if (atEnd) {
                const last = sections[sections.length - 1].key;
                const el = sectionEl(last);
                if (el && el.getBoundingClientRect().top < window.innerHeight) current = last;
            }
            setActive(current);
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        onScroll();
        return () => {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [sections]);

    // Opened at a section (?section=): go straight there, no animation.
    useEffect(() => {
        if (initial && initial !== sections[0].key) {
            requestAnimationFrame(() => scrollPageTo(initial, false));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onGo = (e: Event) => {
            const key = (e as CustomEvent).detail?.key;
            if (key) scrollPageTo(key, true);
        };
        window.addEventListener(EVENT, onGo);
        return () => window.removeEventListener(EVENT, onGo);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The underline sits under the active tab's words, and the row scrolls to
    // keep that tab in view.
    const place = () => {
        const label = labelRefs.current[active];
        if (label) setLine({ left: label.offsetLeft, width: label.offsetWidth });
    };
    useLayoutEffect(place, [active]);
    useEffect(() => {
        // Fonts can land after the first measure and widen the words.
        document.fonts?.ready.then(place).catch(() => {});
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);
    useEffect(() => {
        const scroller = scrollerRef.current;
        const tab = tabRefs.current[active];
        if (!scroller || !tab) return;
        const left = tab.offsetLeft + tab.offsetWidth / 2 - scroller.clientWidth / 2;
        scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }, [active]);

    return (
        <>
            <div ref={sentinelRef} aria-hidden="true" />
            <div
                className={`sticky z-40 -mx-6 mb-6 bg-white transition-shadow duration-200 ${stuck ? 'shadow-[0_4px_8px_-4px_rgba(0,0,0,0.12)]' : ''}`}
                style={{ top: HEADER_H }}
            >
                <nav
                    ref={scrollerRef}
                    aria-label="Listing sections"
                    className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    <div className="relative flex w-max min-w-full px-3">
                        {sections.map(({ key, label }) => (
                            <button
                                key={key}
                                ref={(el) => { tabRefs.current[key] = el; }}
                                type="button"
                                onClick={() => scrollPageTo(key, true)}
                                aria-current={active === key ? 'true' : undefined}
                                className={`h-12 flex-none whitespace-nowrap px-3 text-sm font-semibold transition-colors duration-200 ${active === key ? 'text-slate-900' : 'text-slate-500'}`}
                            >
                                <span ref={(el) => { labelRefs.current[key] = el; }}>{label}</span>
                            </button>
                        ))}
                        {line && (
                            <span
                                aria-hidden="true"
                                className="pointer-events-none absolute bottom-1.5 left-0 h-0.5 rounded-full bg-brand transition-[transform,width] duration-300 ease-out"
                                style={{ width: line.width, transform: `translateX(${line.left}px)` }}
                            />
                        )}
                    </div>
                </nav>
            </div>
        </>
    );
}

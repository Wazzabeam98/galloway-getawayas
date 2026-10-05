'use client';

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

// A multi-line box that grows with its text, Airbnb-style: no scrollbar inside
// it, and `rows` is the minimum height when it is empty or short.
export default function AutoTextarea({ value, rows = 3, className = '', style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
    const ref = useRef<HTMLTextAreaElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }, [value]);

    return (
        <textarea
            ref={ref}
            value={value}
            rows={rows}
            className={className}
            style={{ ...style, overflow: 'hidden', resize: 'none' }}
            {...rest}
        />
    );
}

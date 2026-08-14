'use client';

import { Star } from 'lucide-react';

interface Props {
    value: number;
    onChange?: (v: number) => void;
    size?: number;
}

export default function ReviewStars({ value, onChange, size = 20 }: Props) {
    const interactive = !!onChange;

    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    disabled={!interactive}
                    onClick={() => onChange && onChange(n)}
                    className={interactive ? 'cursor-pointer' : 'cursor-default'}
                >
                    <Star
                        style={{ width: size, height: size }}
                        className={n <= value ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}
                    />
                </button>
            ))}
        </div>
    );
}

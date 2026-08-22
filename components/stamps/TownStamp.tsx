import type { ReactNode } from 'react';
import { townKey, townOf } from '@/lib/places';

// Line-drawn "stamp print" of each town's most iconic landmark, for the
// passport.
//
// Adding a town is one entry in STAMPS below: the key is whatever
// townKey() in lib/places.ts returns for that town ("gatehouseoffleet",
// "newtonstewart"), and the value is the bare drawing. Everything else —
// the svg element, the postmark ring, the size, the colour — is handled by
// the frame here, so a new stamp is only ever the lines themselves.
//
// Rules for drawing one:
//
//   * 64x64 viewBox, and keep the drawing inside roughly x 9-55, y 16-50 so
//     it clears the ring.
//   * No fills, no Tailwind classes, no colours. Stroke is inherited from
//     the frame, which uses currentColor — a class name in here would work,
//     but a class name in lib/ would not, and this is the same family of
//     drawing, so treat both the same and never hard-code a colour.
//   * A dozen confident lines, like a rubber stamp. It has to read at 56px,
//     so anything that needs full width is wrong. Squint at it: if the
//     landmark is not obvious as a silhouette, simplify rather than add.

type Stamp = {
    // What the drawing is of, for screen readers and for the next person
    // adding one.
    landmark: string;
    art: ReactNode;
};

// Kirkcudbright — MacLellan's Castle. The roofless 16th-century tower house
// in the middle of the town: tall stair tower on the left, crow-stepped
// gable and chimney stacks on the right, empty windows throughout.
const kirkcudbright: Stamp = {
    landmark: "MacLellan's Castle",
    art: (
        <>
            {/* ground */}
            <path d="M8 50 H56" />
            {/* stair tower, left, with its chimney */}
            <path d="M14 50 V21 H24 V50" />
            <path d="M16 21 V16 H20 V21" />
            {/* main block, its wall head stepping down to the right */}
            <path d="M24 50 V30 H44 V34 H48 V38 H52 V50" />
            <path d="M35 30 V25 H39 V30" />
            {/* empty windows, filled so they still read as holes when small */}
            <path d="M17 26 H21 V31 H17 Z" fill="currentColor" />
            <path d="M28 33 H32 V38 H28 Z" fill="currentColor" />
            <path d="M36 33 H40 V38 H36 Z" fill="currentColor" />
            {/* arched door */}
            <path d="M29 50 V44 q3 -4 6 0 V50" />
        </>
    ),
};

// Keyed by townKey(). Add a town by adding a line.
const STAMPS: Record<string, Stamp> = {
    kirkcudbright,
};

// Any town nobody has drawn yet. Not a placeholder to be replaced in a
// hurry — a cottage under the hills is true of everywhere down here, so a
// town can sit on this one indefinitely and the passport still looks
// finished.
const FALLBACK: Stamp = {
    landmark: 'Dumfries & Galloway',
    art: (
        <>
            {/* hills, kept either side so they never cut across the roof */}
            <path d="M8 45 q7 -8 14 -1" />
            <path d="M42 44 q7 -7 14 1" />
            {/* ground */}
            <path d="M8 50 H56" />
            {/* cottage */}
            <path d="M26 50 V38 H38 V50" />
            <path d="M22 39 L32 30 L42 39" />
            <path d="M36 33 V28 H39 V31" />
            <path d="M29 50 V44 H35 V50" />
        </>
    ),
};

export function stampFor(location: string | null): Stamp {
    return STAMPS[townKey(location)] || FALLBACK;
}

export default function TownStamp({
    location,
    size = 56,
    className,
}: {
    location: string | null;
    size?: number;
    className?: string;
}) {
    const stamp = stampFor(location);
    const title = stamp.landmark + ', ' + townOf(location);

    return (
        <svg
            viewBox="0 0 64 64"
            width={size}
            height={size}
            className={className}
            role="img"
            aria-label={title}
        >
            <title>{title}</title>
            {/* postmark ring, lighter than the drawing so the landmark reads first */}
            <circle
                cx="32"
                cy="32"
                r="30"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.4"
            />
            <g
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                {stamp.art}
            </g>
        </svg>
    );
}

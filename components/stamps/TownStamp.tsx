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

// Kirkcudbright — the Tolbooth. Drawn from a photograph: the tower stands
// at the left end of a long two-storey hall, not on its own. Square tower
// with a pointed turret at each corner, two visible from the front flanking
// the base of a thin needle spire, clock on the face, and the forestair
// climbing tight against the tower where it meets the hall.
//
// The pinnacle cluster is the point of the drawing — without it this is any
// clock tower anywhere, and castle battlements (tried first) read as a
// generic blocky building. The hall is what stops it reading as a church.
//
// Two things here are deliberate and easy to "tidy" wrongly:
//   * The hall is 1.35x the tower's width, not the true 2x. At 2x the whole
//     building has to shrink to stay inside the ring, the tower drops to
//     about 14 units, and the pinnacles close into one blunt peak.
//   * The roof is a long horizontal ridge dropping to a sloped verge at the
//     far end, and the eaves overhang the end wall by two units. That
//     overhang is doing real work: without it the roof reads as a 3D box
//     lid against the flat elevation of everything else. A centred triangle
//     instead reads as a lean-to sloping away from the tower, and a plain
//     band with a vertical end reads as a flat-roofed modern extension.
const kirkcudbright: Stamp = {
    landmark: 'the Tolbooth',
    art: (
        <>
            {/* ground */}
            <path d="M12 52 H54" />
            {/* tower */}
            <path d="M13 52 V24 H30 V52" />
            {/* corner pinnacles, lower than the spire. The gaps either side of
                the spire are ~2.5 units on purpose — any tighter and the three
                points close into one blunt peak at card size. */}
            <path d="M13.5 24 L15 17 L16.5 24" />
            <path d="M26.5 24 L28 17 L29.5 24" />
            {/* needle spire between them */}
            <path d="M19 24 L21.5 5 L24 24" />
            {/* clock. Left as a plain ring: hands this small close up into a
                solid blob and the face stops reading as a clock at all. */}
            <circle cx="21.5" cy="30" r="3.5" />
            {/* hall: eaves running away to the right, overhanging its end wall.
                The roof is a deep slate plane, near enough 40% of the hall's
                height — in the photograph it is the biggest single surface on
                the building, not a thin cap. */}
            <path d="M30 41 H56" />
            <path d="M54 41 V52" />
            {/* long horizontal ridge, dropping to a sloped verge at the far end */}
            <path d="M30 34 H50 L56 41" />
            {/* chimney stack near the far end */}
            <path d="M45 34 V29 H48 V34" />
            {/* first-floor door and the forestair tight against the tower */}
            <path d="M25.5 46 V40 H29.5 V46" />
            <path d="M30 46 H31.6 V48 H33.2 V50 H34.8 V52" />
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

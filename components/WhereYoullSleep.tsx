import { BedDouble } from 'lucide-react';
import { normaliseArrangements, bedSummary, roomLabel, type Room } from '@/lib/sleeping';

// "Where you'll sleep" — one card per room, each showing the beds in it, the way
// Airbnb lays it out. Deliberately FLAT (a bordered card on the tinted page, no
// lift): this is something a guest scans to answer "will the seven of us fit",
// not a surface they act on. See the lifted-card note in CLAUDE.md.
//
// Renders nothing when a listing has no arrangements yet, so an older listing
// simply doesn't grow an empty section until its host fills the beds in.
export default function WhereYoullSleep({ arrangements }: { arrangements: any }) {
    const rooms: Room[] = normaliseArrangements(arrangements).filter(
        (r) => r.beds.some((b) => b.count > 0)
    );
    if (rooms.length === 0) return null;

    let bedroomSeen = 0;

    return (
        <section id="sleeping" className="mt-8 pt-8 border-t scroll-mt-24">
            <h2 className="text-xl font-semibold text-slate-900">Where you&apos;ll sleep</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {rooms.map((room, i) => {
                    if (room.kind === 'bedroom') bedroomSeen += 1;
                    return (
                        <div
                            key={i}
                            className="rounded-2xl border border-slate-200 bg-white p-4"
                        >
                            <BedDouble className="h-6 w-6 text-slate-700" strokeWidth={1.5} />
                            <div className="mt-3 font-semibold text-slate-900">
                                {roomLabel(room, bedroomSeen)}
                            </div>
                            <div className="mt-0.5 text-sm text-slate-500">
                                {bedSummary(room.beds)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

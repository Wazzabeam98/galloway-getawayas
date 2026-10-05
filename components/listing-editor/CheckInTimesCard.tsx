'use client';

import { useState } from 'react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';

// Airbnb's "Check-in and checkout times": the times on a raised card, the
// inputs behind it. They save with the listing (check_in_time, check_in_end_time,
// check_out_time), which also times the scheduled messages.

export function checkInTimesSummary(start: string, end: string, checkout: string): string {
    const checkIn = end ? `Check-in ${start}–${end}` : `Check-in after ${start}`;
    return `${checkIn} · Checkout before ${checkout}`;
}

const inputClass = 'w-full p-2.5 border border-slate-300 rounded-lg text-sm mt-1';

export default function CheckInTimesCard({ start, end, checkout, onSave }: {
    start: string;
    end: string;
    checkout: string;
    onSave: (start: string, end: string, checkout: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [s, setS] = useState(start);
    const [e, setE] = useState(end);
    const [c, setC] = useState(checkout);

    const openPanel = () => { setS(start); setE(end); setC(checkout); setOpen(true); };

    return (
        <>
            <EditorCard title="Check-in and checkout" summary={checkInTimesSummary(start, end, checkout)} onClick={openPanel} />
            {open && (
                <EditorPanel title="Check-in and checkout" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(s || '15:00', e, c || '11:00'); setOpen(false); }} />}>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="ci-start" className="text-xs font-semibold text-slate-700">Check-in from</label>
                                <input id="ci-start" type="time" value={s} onChange={(ev) => setS(ev.target.value)} className={inputClass} />
                            </div>
                            <div>
                                <label htmlFor="ci-end" className="text-xs font-semibold text-slate-700">Check-in until</label>
                                <input id="ci-end" type="time" value={e} onChange={(ev) => setE(ev.target.value)} className={inputClass} />
                            </div>
                        </div>
                        <div className="sm:w-1/2 sm:pr-1.5">
                            <label htmlFor="ci-checkout" className="text-xs font-semibold text-slate-700">Checkout by</label>
                            <input id="ci-checkout" type="time" value={c} onChange={(ev) => setC(ev.target.value)} className={inputClass} />
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

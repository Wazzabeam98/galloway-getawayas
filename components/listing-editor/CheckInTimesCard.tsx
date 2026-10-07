'use client';

import { useState } from 'react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { bigFieldCls } from '@/components/services/wizardKit';

// Airbnb's "Check-in and checkout times": the times on a raised card, the
// inputs behind it. They save with the listing (check_in_time, check_in_end_time,
// check_out_time), which also times the scheduled messages.

export function checkInTimesSummary(start: string, end: string, checkout: string): string {
    const checkIn = end ? `Check-in ${start}–${end}` : `Check-in after ${start}`;
    return `${checkIn} · Checkout before ${checkout}`;
}

const inputClass = bigFieldCls;

export default function CheckInTimesCard({ start, end, checkout, onSave }: {
    start: string;
    end: string;
    checkout: string;
    onSave: (start: string, end: string, checkout: string) => unknown;
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
                <EditorPanel title="When can guests check in and out?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(s || '15:00', e, c || '11:00'))) setOpen(false); }} />}>
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="ci-start" className="text-base font-semibold text-slate-800">Check-in from</label>
                                <input id="ci-start" type="time" value={s} onChange={(ev) => setS(ev.target.value)} className={inputClass} />
                            </div>
                            <div>
                                <label htmlFor="ci-end" className="text-base font-semibold text-slate-800">Check-in until</label>
                                <input id="ci-end" type="time" value={e} onChange={(ev) => setE(ev.target.value)} className={inputClass} />
                            </div>
                        </div>
                        <div className="sm:w-1/2 sm:pr-1.5">
                            <label htmlFor="ci-checkout" className="text-base font-semibold text-slate-800">Checkout by</label>
                            <input id="ci-checkout" type="time" value={c} onChange={(ev) => setC(ev.target.value)} className={inputClass} />
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

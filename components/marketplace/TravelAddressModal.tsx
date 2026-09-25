'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { hasUkPostcode } from '@/lib/postcode';
import AddressLookup, { AddressParts, EMPTY_ADDRESS, composeAddressLine } from '@/components/address/AddressLookup';

// The "Add address" modal for a comes-to-you booking — a chef, a masseur,
// anyone who travels to where the guest is staying. It replaces the single
// free-text box that used to sit on the chef panels with the same labelled
// street / town / postcode fields the food basket already uses (the shared
// AddressLookup widget), so the address arrives as parts and reads back
// cleanly rather than as one line somebody typed however they liked.
//
// It is DELIBERATELY thinner than DeliveryAddressModal: a chef travelling to a
// cottage is not a delivery, so there is no delivery-reach preflight and no
// saving to the guest's delivery address book. Hand-entry only (searchEnabled
// false) — the address routes spend a paid lookup and need a signed-in user,
// and this panel is reachable by an anonymous booker, so the fields that always
// work are the ones shown. Validation appears only on Save.
export default function TravelAddressModal({
    who, initial, onSave, onClose,
}: {
    who: string;
    initial: AddressParts | null;
    onSave: (result: { parts: AddressParts; line: string }) => void;
    onClose: () => void;
}) {
    const [parts, setParts] = useState<AddressParts>(initial || EMPTY_ADDRESS);
    const [showErrors, setShowErrors] = useState(false);

    const line = composeAddressLine(parts);
    // The same completeness rule as the delivery modal: a postcode, and a
    // street or a house name — enough for someone to actually find the door.
    const complete = !!parts.postcode.trim() && hasUkPostcode(line) && !!(parts.street.trim() || parts.house.trim());

    function save() {
        setShowErrors(true);
        if (!complete) return;
        onSave({ parts, line });
    }

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Address"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pt-6 sm:max-w-md sm:rounded-2xl">
                <button type="button" onClick={onClose} aria-label="Close"
                    className="absolute right-3 top-4 rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                <h2 className="text-lg font-semibold text-slate-900">{initial ? 'Edit address' : 'Add address'}</h2>
                <p className="mt-0.5 text-sm text-slate-500">Where should {who} come?</p>

                <div className="mt-4">
                    <AddressLookup value={parts} onChange={setParts} searchEnabled={false} showErrors={showErrors} />
                </div>

                <div className="mt-5 flex gap-2">
                    <button type="button" onClick={onClose}
                        className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        Cancel
                    </button>
                    <button type="button" onClick={save} disabled={showErrors && !complete}
                        className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                        Save address
                    </button>
                </div>
            </div>
        </div>, document.body,
    );
}

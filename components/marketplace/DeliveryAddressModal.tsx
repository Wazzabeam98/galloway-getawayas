'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { hasUkPostcode } from '@/lib/postcode';
import AddressLookup, { AddressParts, EMPTY_ADDRESS, composeAddressLine } from '@/components/address/AddressLookup';

export interface SavedAddressResult {
    parts: AddressParts;
    line: string;
}

// The "Add delivery address" modal for the food basket. A postcode search at the
// top (AddressLookup, the shared widget), labelled fields below it, hand-entry
// always available. Validation shows only on Save.
//
// Save does three things, in order, and stops at the first that fails:
//   1. the address is complete (a postcode, and a street or house name);
//   2. the provider can actually reach it — the SAME reach check the order route
//      runs, called early here (/api/services/delivery-reach) so an out-of-area
//      postcode is refused in the modal, not at the Pay button;
//   3. if the guest is signed in, it's remembered on their account (best-effort;
//      a save that can't be remembered still completes the order flow).
// The order route re-runs the reach check on the frozen provider row regardless,
// so this early check is a courtesy, never the authority.
export default function DeliveryAddressModal({
    providerId, signedIn, initial, onSave, onClose,
}: {
    providerId: string;
    signedIn: boolean;
    initial: AddressParts | null;
    onSave: (result: SavedAddressResult) => void;
    onClose: () => void;
}) {
    const [parts, setParts] = useState<AddressParts>(initial || EMPTY_ADDRESS);
    const [showErrors, setShowErrors] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const line = composeAddressLine(parts);
    const complete = !!parts.postcode.trim() && hasUkPostcode(line) && !!(parts.street.trim() || parts.house.trim());

    async function save() {
        setError(null);
        setShowErrors(true);
        if (!parts.postcode.trim() || !(parts.street.trim() || parts.house.trim())) return;
        if (!hasUkPostcode(line)) { setError('That postcode doesn’t look complete — please check it.'); return; }

        setBusy(true);
        try {
            // The reach preflight. A refusal (reachable:false) blocks with the
            // provider's own message; a network/500 fails OPEN — the order route
            // will re-check before any money moves, so a wobble here shouldn't
            // trap a guest who is genuinely in range.
            try {
                const res = await fetch('/api/services/delivery-reach', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providerId, postcode: parts.postcode.trim() }),
                });
                const d = await res.json();
                if (res.ok && d && d.ok && d.reachable === false) {
                    setError(d.message || 'Sorry — that address is outside the delivery area.');
                    setBusy(false);
                    return;
                }
            } catch { /* fail open — the order route re-checks */ }

            // Remember it on the account (signed-in only, best-effort).
            if (signedIn) {
                try {
                    await fetch('/api/guest/delivery-addresses', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...parts, line }),
                    });
                } catch { /* a save that can't be remembered still completes */ }
            }

            onSave({ parts, line });
        } finally {
            setBusy(false);
        }
    }

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Delivery address"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pt-6 sm:max-w-md sm:rounded-2xl">
                <button type="button" onClick={onClose} aria-label="Close"
                    className="absolute right-3 top-4 rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                <h2 className="text-lg font-semibold text-slate-900">{initial ? 'Edit delivery address' : 'Add delivery address'}</h2>
                <p className="mt-0.5 text-sm text-slate-500">Where should your order be delivered?</p>

                <div className="mt-4">
                    <AddressLookup value={parts} onChange={setParts} searchEnabled={signedIn} showErrors={showErrors} />
                </div>

                {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

                <div className="mt-5 flex gap-2">
                    <button type="button" onClick={onClose}
                        className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        Cancel
                    </button>
                    <button type="button" onClick={save} disabled={busy || (showErrors && !complete)}
                        className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? 'Checking…' : 'Save address'}
                    </button>
                </div>
            </div>
        </div>, document.body,
    );
}

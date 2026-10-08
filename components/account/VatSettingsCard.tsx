'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { vatNumberProblem, vatNameProblem } from '@/lib/vat';

// "VAT registered" — one card for a host (no providerId) and for an experience
// provider or trade (providerId). Private: read and written through
// /api/account/vat only, never shown on a public page. The rule is lib/vat.ts,
// the same one the route checks before saving.

interface Saved {
    registered: boolean;
    number: string;
    name: string;
    suggestedName: string;
}

const BLURB = {
    host: 'If you’re VAT registered, we’ll put your VAT number and business name on your guests’ booking receipts and on your earnings, as the supplier of the stay. It’s never shown on your listing.',
    experience: 'If you’re VAT registered, we’ll put your VAT number and business name on your guests’ booking receipts and on your earnings, as the supplier. It’s never shown on your public page.',
    trade: 'Owners pay you directly and you invoice them yourself, so this is kept privately with your business. It’s never shown on your public profile.',
};

export default function VatSettingsCard({ providerId, audience = 'host' }: { providerId?: string; audience?: 'host' | 'experience' | 'trade' }) {
    const [saved, setSaved] = useState<Saved | null>(null);
    const [registered, setRegistered] = useState(false);
    const [number, setNumber] = useState('');
    const [name, setName] = useState('');
    const [touched, setTouched] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState<{ field?: string; message: string } | null>(null);

    const query = providerId ? '?providerId=' + encodeURIComponent(providerId) : '';

    useEffect(() => {
        let live = true;
        fetch('/api/account/vat' + query)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: Saved | null) => {
                if (!live || !data) return;
                setSaved(data);
                setRegistered(data.registered);
                setNumber(data.number);
                setName(data.name || data.suggestedName || '');
            })
            .catch(() => {});
        return () => { live = false; };
    }, [query]);

    const numberProblem = registered ? vatNumberProblem(number) : null;
    const nameProblem = registered ? vatNameProblem(name) : null;
    const unchanged = !!saved
        && saved.registered === registered
        && (!registered || (saved.number.replace(/\s/g, '') === number.replace(/\s/g, '').toUpperCase()
            && saved.name === name.trim()));

    const save = async () => {
        setTouched(true);
        setServerError(null);
        if (numberProblem || nameProblem) return;
        setSaving(true);
        try {
            const res = await fetch('/api/account/vat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: providerId || null, registered, number, name }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setServerError({ field: data.field, message: data.error || 'Your VAT details could not be saved.' });
                return;
            }
            setSaved(data);
            setRegistered(data.registered);
            setNumber(data.number);
            setName(data.name || data.suggestedName || '');
            setTouched(false);
            toast.success(data.registered ? 'VAT details saved' : 'Saved — you’re not VAT registered');
        } catch {
            setServerError({ message: 'Your VAT details could not be saved. Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    const fieldError = (field: 'number' | 'name', local: string | null) =>
        (touched && local) || (serverError && serverError.field === field ? serverError.message : null);

    return (
        <div className="border rounded-2xl p-6">
            <h3 className="font-semibold text-slate-900">VAT</h3>
            <p className="text-sm text-slate-500 mt-1">{BLURB[audience]}</p>

            {!saved ? (
                <div className="mt-4 h-6 w-48 rounded bg-slate-100 animate-pulse" />
            ) : (
                <>
                    <label className="mt-5 flex items-center gap-3 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={registered}
                            onChange={(e) => { setRegistered(e.target.checked); setServerError(null); }}
                            className="h-5 w-5 rounded border-slate-300 accent-slate-900"
                        />
                        <span className="text-sm font-medium text-slate-800">I&apos;m VAT registered</span>
                    </label>

                    {registered && (
                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="vat-number" className="block text-sm font-medium text-slate-700 mb-1.5">VAT number</label>
                                <input
                                    id="vat-number"
                                    inputMode="text"
                                    autoComplete="off"
                                    placeholder="GB 123 4567 89"
                                    value={number}
                                    onChange={(e) => { setNumber(e.target.value); setServerError(null); }}
                                    onBlur={() => setTouched(true)}
                                    className={`w-full border rounded-xl px-3.5 py-2.5 text-base outline-none focus:border-slate-900 ${fieldError('number', numberProblem) ? 'border-red-400' : 'border-slate-300'}`}
                                />
                                {fieldError('number', numberProblem) && (
                                    <p className="text-xs text-red-600 mt-1.5">{fieldError('number', numberProblem)}</p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="vat-name" className="block text-sm font-medium text-slate-700 mb-1.5">Business name registered for VAT</label>
                                <input
                                    id="vat-name"
                                    autoComplete="organization"
                                    value={name}
                                    onChange={(e) => { setName(e.target.value); setServerError(null); }}
                                    onBlur={() => setTouched(true)}
                                    className={`w-full border rounded-xl px-3.5 py-2.5 text-base outline-none focus:border-slate-900 ${fieldError('name', nameProblem) ? 'border-red-400' : 'border-slate-300'}`}
                                />
                                {fieldError('name', nameProblem) && (
                                    <p className="text-xs text-red-600 mt-1.5">{fieldError('name', nameProblem)}</p>
                                )}
                            </div>
                        </div>
                    )}

                    {serverError && !serverError.field && (
                        <p className="text-sm text-red-600 mt-3">{serverError.message}</p>
                    )}

                    <div className="mt-5 flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving || unchanged}
                            className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl transition disabled:opacity-40"
                        >
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                        {audience !== 'trade' && (
                            <span className="text-xs text-slate-400">
                                Applies to bookings made from when you save.
                            </span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

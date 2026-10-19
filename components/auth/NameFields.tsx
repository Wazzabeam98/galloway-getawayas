'use client';

import { RefObject } from 'react';
import { validatePersonName } from '@/lib/personName';

// First name and last name, as Airbnb's Finish signing up asks for them: two
// boxes, one line under them saying who sees what. Used by every screen that
// asks for a name (the sign-in panel, the sign-up takeover, the modal), so
// they all look and check the same.

export type NameError = { field: 'first' | 'last' | null; message: string } | null;

// Saves through /api/account/name — the only writer of the two columns, which
// runs the same validatePersonName as the form. Also mirrors the name onto the
// auth user, where parts of the page read a greeting name from before the
// profile has loaded.
export async function saveMyName(supabase: any, first: string, last: string): Promise<NameError> {
    const check = validatePersonName(first, last);
    if (!check.ok) return { field: check.field, message: check.message };
    const res = await fetch('/api/account/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first: check.first, last: check.last }),
    }).then((r) => r.json()).catch(() => null);
    if (!res || !res.ok) {
        return { field: (res && res.field) || null, message: (res && res.error) || 'We couldn’t save your name. Check your connection and try again.' };
    }
    try { await supabase.auth.updateUser({ data: { name: check.first + ' ' + check.last } }); } catch { /* the profile is what counts */ }
    return null;
}

export default function NameFields({
    first, last, onFirst, onLast, error, inputClass, labelClass, firstRef, idPrefix = 'name',
}: {
    first: string;
    last: string;
    onFirst: (v: string) => void;
    onLast: (v: string) => void;
    error: NameError;
    inputClass: string;
    labelClass: string;
    firstRef?: RefObject<HTMLInputElement>;
    idPrefix?: string;
}) {
    const bad = (f: 'first' | 'last') => !!error && error.field === f;
    return (
        <div className="space-y-4">
            <div>
                <label htmlFor={idPrefix + '-first'} className={labelClass}>First name</label>
                <input
                    ref={firstRef}
                    id={idPrefix + '-first'}
                    type="text"
                    autoComplete="given-name"
                    value={first}
                    onChange={(e) => onFirst(e.target.value)}
                    aria-invalid={bad('first') || undefined}
                    className={inputClass + (bad('first') ? ' border-red-500' : '')}
                />
            </div>
            <div>
                <label htmlFor={idPrefix + '-last'} className={labelClass}>Last name</label>
                <input
                    id={idPrefix + '-last'}
                    type="text"
                    autoComplete="family-name"
                    value={last}
                    onChange={(e) => onLast(e.target.value)}
                    aria-invalid={bad('last') || undefined}
                    className={inputClass + (bad('last') ? ' border-red-500' : '')}
                />
            </div>
            <p className="text-xs text-slate-500 [text-wrap:pretty]">
                Make sure this matches the name on your government ID. You can add a preferred name later in your account.
            </p>
        </div>
    );
}

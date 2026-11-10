'use client';

import { AlertCircle } from 'lucide-react';
import { listingContactKind, listingContactMessage } from '@/lib/listingContact';

// The inline note under a listing field that has an email, phone number, web
// address or social handle in it — Airbnb's, shown as the host types, with
// that field's Save held until it is gone. The save routes refuse the same
// text with the same words (lib/listingContact), so this is the friendly half
// of a rule the server enforces.
export function hasContactDetails(...texts: Array<string | null | undefined>): boolean {
    return texts.some((t) => !!listingContactKind(t));
}

export default function ContactNote({ text, className = '' }: { text: string | null | undefined; className?: string }) {
    const kind = listingContactKind(text);
    if (!kind) return null;
    return (
        <p role="alert" className={`mt-2 flex items-start gap-1.5 text-sm text-red-700 ${className}`}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            <span>{listingContactMessage(kind)}</span>
        </p>
    );
}

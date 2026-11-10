'use client';

import { AlertCircle } from 'lucide-react';
import { listingContactKind, listingContactScan, listingContactMessage, listingContactFieldMessage } from '@/lib/listingContact';

// The inline note under a listing field that has an email, phone number, web
// address or social handle in it — Airbnb's, shown as the host types. The
// publish gate and the live-edit save refuse the same text with the same words
// (lib/listingContact), so this is the friendly half of a rule the server
// enforces at Publish. A `label` names the field and the note quotes exactly
// what to remove ("Please remove pods@thecroft from your title").
export function hasContactDetails(...texts: Array<string | null | undefined>): boolean {
    return texts.some((t) => !!listingContactKind(t));
}

export default function ContactNote({ text, label, className = '' }: { text: string | null | undefined; label?: string; className?: string }) {
    const scan = listingContactScan(text);
    if (!scan) return null;
    const message = label ? listingContactFieldMessage(label, scan.match) : listingContactMessage(scan.kind);
    return (
        <p role="alert" className={`mt-2 flex items-start gap-1.5 text-sm text-red-700 ${className}`}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            <span>{message}</span>
        </p>
    );
}

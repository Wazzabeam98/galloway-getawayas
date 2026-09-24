'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

// The one pop-up used across the host reservation page — a card's detail, the
// full cancellation policy, the Manage-reservation actions. Airbnb's shape: a
// sheet that rises from the bottom on a phone and a centred modal on a wider
// screen, so every tap-to-open surface on the page behaves the same way.
//
// Uncontrolled with a `trigger` (the common case — tap a card, read the
// detail), or controlled via `open`/`onOpenChange` when the opener lives
// elsewhere or the body switches between views.
export default function Modal({
    trigger,
    open,
    onOpenChange,
    title,
    description,
    children,
}: {
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
                <Dialog.Content
                    className="fixed z-50 flex max-h-[85dvh] flex-col overflow-hidden border border-slate-200 bg-white shadow-xl focus:outline-none
                        inset-x-0 bottom-0 rounded-t-2xl
                        data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom
                        sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl
                        sm:data-[state=open]:slide-in-from-bottom-2"
                >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                        <div className="min-w-0">
                            <Dialog.Title className="text-base font-semibold text-slate-900">{title}</Dialog.Title>
                            {description && <Dialog.Description className="mt-0.5 text-[13px] text-slate-500">{description}</Dialog.Description>}
                        </div>
                        <Dialog.Close className="-mr-1 flex-none rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                            <X className="h-4 w-4" />
                            <span className="sr-only">Close</span>
                        </Dialog.Close>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

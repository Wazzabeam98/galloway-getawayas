'use client';

import { requireName } from '@/components/auth/FinishSignUpGate';

// Opens Finish signing up (first and last name) from a dashboard prompt, then
// reloads so the prompt and every name on the page update.
export default function AddNameButton({ className, children }: { className: string; children: React.ReactNode }) {
    return (
        <button
            type="button"
            className={className}
            onClick={async () => { if (await requireName()) window.location.reload(); }}
        >
            {children}
        </button>
    );
}

'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { EyeOff, Eye } from 'lucide-react';
import { toast } from 'react-toastify';

// Hiding takes a property out of search and stops new bookings. Stays that are
// already booked are untouched — a host who wants to stop letting still has to
// see out the guests who have paid.
export default function HideListingBtn({
    id,
    hidden,
}: {
    id: string;
    hidden: boolean;
}) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const [working, setWorking] = useState(false);

    const toggle = async () => {
        setWorking(true);

        const { error } = await supabase
            .from('listings')
            .update({ status: hidden ? 'published' : 'hidden' })
            .eq('id', id);

        setWorking(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success(
            hidden
                ? 'Back on the site and taking bookings.'
                : 'Hidden. Bookings you already have are unaffected.',
            { theme: 'colored' }
        );
        router.refresh();
    };

    return (
        <button
            type="button"
            onClick={toggle}
            disabled={working}
            title={hidden ? 'Show this listing again' : 'Hide from the site'}
            className="w-8 h-8 rounded-full bg-white/95 shadow-sm flex items-center justify-center text-slate-700 hover:text-slate-900 disabled:opacity-50"
        >
            {hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
    );
}

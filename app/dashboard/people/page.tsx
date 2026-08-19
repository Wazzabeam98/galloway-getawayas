import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PeopleManager from '@/components/PeopleManager';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getUser();

    if (!auth || !auth.user) redirect('/');

    // Only listings this person actually owns. A co-host cannot hand out
    // access to a property that isn't theirs, however much else they can do.
    const { data: listings } = await supabase
        .from('listings')
        .select('id, title')
        .eq('host_id', auth.user.id)
        .order('title');

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">People</h1>
            <p className="text-sm text-slate-500 mb-8">
                Co-hosts help you run a property. Cleaners and other staff just need to know when
                guests come and go. Either way, the money stays with you.
            </p>

            <PeopleManager listings={listings || []} />
        </div>
    );
}

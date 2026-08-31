export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { enquiryThreadContext } from '@/lib/enquiryThreads';
import EnquiryThread from '@/components/services/EnquiryThread';

export const metadata = {
    title: 'Job messages',
    robots: { index: false, follow: false },
};

export default async function EnquiryThreadPage({ params }: { params: { enquiryId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const ctx = await enquiryThreadContext(admin, params.enquiryId, user.id);
    if (!ctx) redirect('/');

    // Back to wherever this side finds their threads: the tradesman's job
    // messages list, or the host's enquiries.
    const backHref = ctx.isProvider ? '/services/messages' : '/dashboard/enquiries';

    return <EnquiryThread enquiryId={params.enquiryId} backHref={backHref} />;
}

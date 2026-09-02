import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { orderThreadContext } from '@/lib/orderThreads';
import OrderThread from '@/components/marketplace/OrderThread';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Booking messages', robots: { index: false, follow: false } };

// The provider's view of an order thread — reached from their messages inbox.
// The guest sees the same thread on their booking page; this is the other end.
export default async function ProviderOrderThreadPage({ params }: { params: { orderId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const ctx = await orderThreadContext(admin, params.orderId, user.id);
    // Only a participant, and only the provider side reaches this page.
    if (!ctx || ctx.isGuest) redirect('/services/messages');

    return (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
            <Link href="/services/messages" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                <ArrowLeft className="h-4 w-4" /> Messages
            </Link>
            <div className="mt-3">
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{ctx.otherName}</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                    {ctx.order.item_name || 'Experience'}{ctx.order.service_date ? ' · ' + String(ctx.order.service_date) : ''}
                </p>
            </div>
            <OrderThread orderId={params.orderId} />
        </div>
    );
}

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { listEnquiryThreadsFor } from '@/lib/enquiryThreads';
import { listProviderOrderThreads } from '@/lib/orderThreads';
import { MessageSquare, ChevronRight } from 'lucide-react';

export const metadata = {
    title: 'Messages',
    robots: { index: false, follow: false },
};

function when(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

export default async function JobMessagesPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const [enquiries, orders] = await Promise.all([
        listEnquiryThreadsFor(admin, user.id),
        listProviderOrderThreads(admin, user.id),
    ]);

    // One list, both kinds — job threads and experience-order threads — newest
    // first, each linking to the right thread page.
    const items = [
        ...enquiries.map((t) => ({
            key: 'e:' + t.enquiryId,
            href: `/messages/enquiry/${t.enquiryId}`,
            otherName: t.otherName,
            fallback: t.summary,
            lastBody: t.lastBody,
            lastAt: t.lastAt,
            unread: t.unread,
            ended: t.cancelled,
        })),
        ...orders.map((t) => ({
            key: 'o:' + t.orderId,
            href: `/services/messages/order/${t.orderId}`,
            otherName: t.otherName,
            fallback: t.subtitle,
            lastBody: t.lastBody,
            lastAt: t.lastAt,
            unread: t.unread,
            ended: t.ended,
        })),
    ].sort((a, b) => ((b.lastAt || '') < (a.lastAt || '') ? -1 : 1));

    return (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-24">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Messages</h1>
            <p className="mt-1.5 text-sm text-slate-500">Your job and booking threads — where what was agreed is written down.</p>

            {items.length === 0 ? (
                <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                    <p className="font-semibold text-slate-900">No messages yet.</p>
                    <p className="text-sm text-slate-600 mt-1.5">Once a job is accepted or a guest books you, you can message about it from here.</p>
                </div>
            ) : (
                <ul className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                    {items.map((t) => (
                        <li key={t.key}>
                            <Link href={t.href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition">
                                <div className="flex-none w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                                    <MessageSquare className="w-5 h-5 text-slate-400" strokeWidth={1.8} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-bold truncate ${t.unread ? 'text-slate-900' : 'text-slate-800'}`}>{t.otherName}</span>
                                        {t.ended && <span className="flex-none text-[10.5px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-1.5 py-0.5">Ended</span>}
                                        {t.unread > 0 && <span className="flex-none inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold">{t.unread}</span>}
                                        <span className="ml-auto flex-none text-[12px] text-slate-400">{when(t.lastAt)}</span>
                                    </div>
                                    <div className={`text-[13px] truncate mt-0.5 ${t.unread ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                                        {t.lastBody || <span className="italic text-slate-400">{t.fallback}</span>}
                                    </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-300 flex-none" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

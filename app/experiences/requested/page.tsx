import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock3, ShieldCheck, Mail, ArrowRight } from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// The moment a held request lands back from Stripe. A request isn't confirmed —
// the card is authorised, not charged — so this is not "you're booked"; it is
// "your request is in, held not charged, here's what happens next". The order
// row is created by the webhook a beat later, so this page needs nothing from it:
// it confirms the ACT of requesting, and the booking itself shows under Your
// requests once the webhook has written it and the receipt email has gone.
export default async function RequestedPage({ searchParams }: { searchParams: { p?: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    let who = 'the provider';
    if (searchParams.p) {
        const { data: prov } = await adminClient()
            .from('service_providers').select('business_name').eq('id', searchParams.p).maybeSingle();
        if (prov && prov.business_name) who = prov.business_name;
    }

    const steps = [
        { icon: Clock3, title: `${who} has 48 hours to confirm`, body: 'They’ll get your request straight away — with your dates, your note, and any allergy you gave.' },
        { icon: ShieldCheck, title: 'Your card is held, not charged', body: 'Nothing is taken unless they confirm. If they decline or don’t reply in time, the hold is released and that’s the end of it.' },
        { icon: Mail, title: 'We’ll email you either way', body: 'You’ll hear the moment they confirm — that’s when you’re charged and booked. You can also see it under Your requests.' },
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-xl px-4 sm:px-6 py-12 sm:py-16">
                <div className="rounded-3xl bg-white p-6 sm:p-8 shadow-sm ring-1 ring-slate-200">
                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        <Clock3 className="h-3.5 w-3.5" /> Request sent
                    </span>
                    <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                        Your request is with {who}
                    </h1>
                    <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                        They’ll take a look and confirm if they can do it. Here’s what happens next.
                    </p>

                    <ol className="mt-6 space-y-4">
                        {steps.map((s, i) => (
                            <li key={i} className="flex gap-3.5">
                                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-500">
                                    <s.icon className="h-5 w-5" strokeWidth={1.75} />
                                </span>
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">{s.title}</div>
                                    <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>

                    <Link
                        href="/trips"
                        className="mt-7 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                        See it in your trips
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        </div>
    );
}

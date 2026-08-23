import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Every owner page checks for itself. Hiding the link is tidiness, not
// security — this is what actually keeps people out.
async function requireOwner() {
    const supabase = createServerComponentClient({ cookies });

    // getUser(), not getSession(). getSession() only decodes the cookie — it
    // never checks the signature — so the id everything below hangs off would
    // be whatever the caller wrote in it. getUser() asks the auth server,
    // which verifies the token and that the session has not been revoked.
    const { data } = await supabase.auth.getUser();

    if (!data || !data.user) notFound();

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', data.user.id)
        .maybeSingle();

    if (!profile || profile.is_admin !== true) notFound();

    return data.user;
}

const tools = [
    {
        href: '/admin/listings',
        title: 'All listings',
        blurb: 'Every property on the site. Take one down, or put it back.',
    },
    {
        href: '/admin/commission',
        title: 'Commission rates',
        blurb: 'What each property is charged. Blank means the standard rate.',
    },
    {
        href: '/admin/earnings',
        title: 'Earnings by property',
        blurb: 'Every property ranked by what it has taken this year.',
    },
    {
        href: '/admin/payouts',
        title: 'Payouts',
        blurb: 'What each host is owed, and what has already been sent.',
    },
    {
        href: '/admin/disputes',
        title: 'Chargebacks',
        blurb: 'Disputes raised by guests\u2019 banks, and what evidence to send.',
    },
    {
        href: '/admin/errors',
        title: 'Errors',
        blurb: 'Anything that broke, whether or not anyone told us.',
    },
];

export default async function AdminHome() {
    await requireOwner();

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Owner tools</h1>
            <p className="text-sm text-slate-500 mb-8">
                Only you and your business partner can see these pages.
            </p>

            <div className="space-y-3">
                {tools.map((t) => (
                    <Link
                        key={t.href}
                        href={t.href}
                        className="block border rounded-2xl p-5 hover:border-slate-900 transition"
                    >
                        <div className="font-semibold text-slate-900">{t.title}</div>
                        <div className="text-sm text-slate-500 mt-0.5">{t.blurb}</div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

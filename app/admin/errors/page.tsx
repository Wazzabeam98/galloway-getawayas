import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ErrorRow from '@/components/ErrorRow';
import CopyErrorsBtn from '@/components/CopyErrorsBtn';

export const dynamic = 'force-dynamic';

export default async function AdminErrors({
    searchParams,
}: {
    searchParams?: { show?: string };
}) {
    const supabase = createServerComponentClient({ cookies });
    // getUser(), not getSession(). getSession() only decodes the cookie — it
    // never checks the signature — so the id everything below hangs off would
    // be whatever the caller wrote in it. getUser() asks the auth server,
    // which verifies the token and that the session has not been revoked.
    const { data: auth } = await supabase.auth.getUser();

    if (!auth || !auth.user) notFound();

    const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', auth.user.id)
        .maybeSingle();

    if (!me || me.is_admin !== true) notFound();

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const showResolved = searchParams?.show === 'all';

    let query = admin
        .from('error_log')
        .select('id, source, message, detail, path, digest, user_id, user_agent, resolved, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

    if (!showResolved) query = query.eq('resolved', false);

    const { data: errors } = await query;
    const rows = errors || [];

    const { count: outstanding } = await admin
        .from('error_log')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false);

    // Anything in the last day is worth looking at first.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const recent = rows.filter((r: any) => r.created_at >= dayAgo).length;

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Errors</h1>
            <p className="text-sm text-slate-500 mb-6">
                Anything that failed, whether or not the person it happened to told us.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Outstanding</div>
                    <div className={'text-2xl font-bold ' + ((outstanding || 0) > 0 ? 'text-amber-700' : 'text-slate-900')}>
                        {outstanding || 0}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">In the last 24 hours</div>
                    <div className={'text-2xl font-bold ' + (recent > 0 ? 'text-red-700' : 'text-slate-900')}>
                        {recent}
                    </div>
                </div>
            </div>

            <div className="flex gap-2 mb-6 flex-wrap items-center">
                <Link
                    href="/admin/errors"
                    className={
                        'px-4 py-2 rounded-xl text-sm font-semibold border transition ' +
                        (!showResolved ? 'bg-slate-900 text-white border-slate-900' : 'text-slate-600 hover:border-slate-900')
                    }
                >
                    Outstanding
                </Link>
                <Link
                    href="/admin/errors?show=all"
                    className={
                        'px-4 py-2 rounded-xl text-sm font-semibold border transition ' +
                        (showResolved ? 'bg-slate-900 text-white border-slate-900' : 'text-slate-600 hover:border-slate-900')
                    }
                >
                    Everything
                </Link>

                <span className="flex-1" />
                <CopyErrorsBtn rows={rows} />
            </div>

            {rows.length === 0 ? (
                <div className="border rounded-2xl p-8 text-center">
                    <p className="text-slate-600 font-medium">Nothing to see</p>
                    <p className="text-sm text-slate-400 mt-1">
                        {showResolved
                            ? 'No errors have ever been recorded.'
                            : 'Nothing outstanding. Quiet is good.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {rows.map((row: any) => (
                        <ErrorRow key={row.id} row={row} />
                    ))}
                </div>
            )}

            <div className="mt-10 border-t pt-6">
                <p className="text-xs text-slate-400 mb-2">
                    Showing the most recent 100. Marking something done just hides it from this
                    list.
                </p>
                <p className="text-xs text-slate-400">
                    Everything here is also available as JSON at{' '}
                    <span className="font-mono">/api/errors/export?hours=24</span>, using the same
                    secret as the scheduled jobs — handy if you&apos;re fixing things from a
                    terminal rather than reading this page.
                </p>
            </div>
        </div>
    );
}

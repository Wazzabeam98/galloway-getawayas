import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SkillMergeTool from '@/components/admin/SkillMergeTool';

export const dynamic = 'force-dynamic';

// Tidying the tags.
//
// Normalisation catches "Bricklaying" against "bricklaying" and the compact
// form catches "brick laying", but "brickwork" and "bricks" are a judgement
// nothing automatic can safely make. This is where that judgement happens.
//
// Sorted by how many tradesmen hold each tag, because the useful merge is
// almost always a busy tag and a near-miss of it sitting one row apart.
export default async function AdminSkills() {
    const supabase = createServerComponentClient({ cookies });

    // getUser(), not getSession() — the latter only decodes the cookie.
    const { data: auth } = await supabase.auth.getUser();
    if (!auth || !auth.user) notFound();

    const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', auth.user.id)
        .maybeSingle();

    if (!me || me.is_admin !== true) notFound();

    const admin = adminClient();

    const { data: skills, error } = await admin
        .from('service_skills')
        .select('id, label, slug, compact, regulated_concept, merged_into, created_at')
        .order('label');

    if (error) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
                <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                    &larr; Owner tools
                </Link>
                <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-2">Skills</h1>
                <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
                    <div className="font-bold text-red-900">The tags could not be read</div>
                    <p className="text-sm text-red-900 mt-1">{error.message}</p>
                </div>
            </div>
        );
    }

    const rows = skills || [];

    // A count rather than a stored column, for the same reason attribution is
    // a query: a counter is one missed write away from being wrong, and this
    // one decides what gets merged into what.
    const { data: links } = await admin
        .from('service_provider_skills')
        .select('skill_id');

    const uses: Record<string, number> = {};
    for (const link of links || []) {
        uses[link.skill_id] = (uses[link.skill_id] || 0) + 1;
    }

    const live = rows
        .filter((s: any) => !s.merged_into)
        .map((s: any) => ({ ...s, uses: uses[s.id] || 0 }));

    const merged = rows
        .filter((s: any) => s.merged_into)
        .map((s: any) => ({
            ...s,
            into: (rows.filter((r: any) => r.id === s.merged_into)[0] || {}).label || 'something',
        }));

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4">Skills</h1>
            <p className="text-slate-600 text-sm mt-1 mb-8">
                {live.length} tag{live.length === 1 ? '' : 's'} in use
                {merged.length > 0 ? ' · ' + merged.length + ' merged away' : ''}.
                Merging keeps the old word as an alias rather than deleting it, so nothing that
                points at it breaks and the merge can be undone.
            </p>

            <SkillMergeTool skills={live} />

            {merged.length > 0 && (
                <section className="mt-12">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Already merged
                    </h2>
                    <ul className="text-sm text-slate-600 space-y-1">
                        {merged.map((s: any) => (
                            <li key={s.id}>
                                <span className="line-through">{s.label}</span>
                                {' → '}
                                <span className="text-slate-900 font-medium">{s.into}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

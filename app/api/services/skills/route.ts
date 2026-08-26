import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { skillKey, regulatedConceptFor } from '@/lib/serviceSkills';

export const dynamic = 'force-dynamic';

// Setting a provider's skills tags.
//
// A route rather than a write from the browser, and the reason is not
// convenience. `regulated_concept` is what stops a handyman tagging "boiler
// repair" and appearing to a host as somebody who can touch a boiler — and a
// provider who could insert their own skill row could set it to null. So the
// concept is derived here, under the service role, and neither table is
// writable by `authenticated` at all.
//
// The whole set is sent and reconciled in one call rather than a tag at a
// time: a half-applied set is a listing showing work they have taken off.
const MAX_SKILLS = 20;

export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server. getSession() would only decode the
        // cookie, so anyone could claim to be anyone by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const body = await req.json();
        const providerId = String(body.providerId || '');
        const labels: string[] = Array.isArray(body.labels) ? body.labels : [];

        if (!providerId) {
            return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such business.' }, { status: 404 });
        }

        // Their own listing only.
        if (provider.owner_id !== auth.user.id) {
            return NextResponse.json({ ok: false, error: 'Not yours.' }, { status: 403 });
        }

        // Normalised here as well as in the browser. The browser's copy is for
        // the type-ahead; this one is what actually decides whether two
        // spellings are one tag, and it is the only one that cannot be skipped.
        const keys = labels
            .map((label) => skillKey(label))
            .filter((k): k is NonNullable<typeof k> => k !== null)
            .slice(0, MAX_SKILLS);

        // Deduplicated on the compact form, so somebody sending both
        // "bricklaying" and "brick laying" in one payload gets one tag rather
        // than a unique violation.
        const wanted: Record<string, { label: string; slug: string; compact: string }> = {};
        for (const key of keys) wanted[key.compact] = key;

        const compacts = Object.keys(wanted);

        const { data: existing } = compacts.length
            ? await admin
                .from('service_skills')
                .select('id, compact, merged_into')
                .in('compact', compacts)
            : { data: [] as any[] };

        const byCompact: Record<string, any> = {};
        for (const row of existing || []) byCompact[row.compact] = row;

        const skillIds: string[] = [];

        for (const compact of compacts) {
            const found = byCompact[compact];

            if (found) {
                // A merged tag resolves to the tag it was merged into, so
                // picking up an old alias quietly does the right thing rather
                // than reviving a word somebody has already tidied away.
                skillIds.push(found.merged_into || found.id);
                continue;
            }

            const key = wanted[compact];

            const { data: made, error: makeError } = await admin
                .from('service_skills')
                .insert({
                    label: key.label,
                    slug: key.slug,
                    compact: key.compact,
                    regulated_concept: regulatedConceptFor(key.slug),
                })
                .select('id')
                .single();

            // A race with another provider creating the same tag lands here.
            // Reading it back is the fix, not an error: they wanted the tag,
            // and it now exists.
            if (makeError || !made) {
                const { data: raced } = await admin
                    .from('service_skills')
                    .select('id, merged_into')
                    .eq('compact', key.compact)
                    .maybeSingle();

                if (raced) skillIds.push(raced.merged_into || raced.id);
                continue;
            }

            skillIds.push(made.id);
        }

        const unique = skillIds.filter((id, at) => skillIds.indexOf(id) === at);

        // Replaced wholesale, like the areas and the prices. There are only
        // ever a handful and diffing them would be more code than it saves.
        await admin.from('service_provider_skills').delete().eq('provider_id', providerId);

        if (unique.length) {
            await admin.from('service_provider_skills').insert(
                unique.map((skillId) => ({ provider_id: providerId, skill_id: skillId }))
            );
        }

        return NextResponse.json({ ok: true, count: unique.length });
    } catch (err: any) {
        await logError('service-skills-save', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

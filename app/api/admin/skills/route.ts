import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { regulatedConceptFor } from '@/lib/serviceSkills';

export const dynamic = 'force-dynamic';

// Tidying the tags.
//
// Normalisation catches "Bricklaying" against "bricklaying", and the compact
// form catches "brick laying" — but "brickwork" and "bricks" are a judgement
// nothing automatic can safely make. That is this.
//
// MERGING POINTS, IT DOES NOT DELETE
//
// The losing tag stays as an alias with `merged_into` set. Its providers are
// repointed, the old word still resolves, the merge can be undone, and there
// is a record of what was merged into what. Deleting the row would give none
// of that — and a saved search or a link carrying the old word would simply
// stop working.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const admin = adminClient();

        const { data: me } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', auth.user.id)
            .maybeSingle();

        if (!me || me.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
        }

        const body = await req.json();
        const action = String(body.action || 'merge');

        // Correcting the matcher. A tag flagged as gas work that plainly is
        // not — or one it missed — is fixed here rather than by editing the
        // patterns and hoping, because the patterns do not run again over tags
        // that already exist.
        if (action === 'set_concept') {
            const id = String(body.id || '');
            const raw = String(body.concept || '').trim();
            const concept = raw === '' ? null : raw;

            if (concept !== null && ['gas', 'oil', 'electrical'].indexOf(concept) === -1) {
                return NextResponse.json({ ok: false, error: 'Not a concept we check.' }, { status: 400 });
            }

            const { error } = await admin
                .from('service_skills')
                .update({ regulated_concept: concept })
                .eq('id', id);

            if (error) {
                return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
            }

            return NextResponse.json({ ok: true });
        }

        if (action !== 'merge') {
            return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 });
        }

        const fromId = String(body.fromId || '');
        const toId = String(body.toId || '');

        if (!fromId || !toId) {
            return NextResponse.json({ ok: false, error: 'Two tags are needed.' }, { status: 400 });
        }

        if (fromId === toId) {
            return NextResponse.json(
                { ok: false, error: 'That is the same tag twice.' },
                { status: 400 }
            );
        }

        const { data: pair } = await admin
            .from('service_skills')
            .select('id, label, merged_into, regulated_concept')
            .in('id', [fromId, toId]);

        const from = (pair || []).filter((s: any) => s.id === fromId)[0];
        const to = (pair || []).filter((s: any) => s.id === toId)[0];

        if (!from || !to) {
            return NextResponse.json({ ok: false, error: 'One of those no longer exists.' }, { status: 404 });
        }

        // Merging into an alias would make a chain, and a chain is a lookup
        // that has to loop. The winner has to be a tag in its own right.
        if (to.merged_into) {
            return NextResponse.json(
                { ok: false, error: 'That one has already been merged into something else. Merge into the surviving tag.' },
                { status: 409 }
            );
        }

        if (from.merged_into) {
            return NextResponse.json({ ok: true, alreadyMerged: true });
        }

        // Repoint the providers first, so nobody loses a tag if the second
        // write fails. A provider holding both tags already would collide, so
        // those links are dropped rather than moved.
        const { data: holders } = await admin
            .from('service_provider_skills')
            .select('provider_id')
            .eq('skill_id', fromId);

        const { data: already } = await admin
            .from('service_provider_skills')
            .select('provider_id')
            .eq('skill_id', toId);

        const haveWinner = (already || []).map((r: any) => r.provider_id);

        const toMove = (holders || [])
            .map((r: any) => r.provider_id)
            .filter((id: string) => haveWinner.indexOf(id) === -1);

        if (toMove.length) {
            await admin
                .from('service_provider_skills')
                .insert(toMove.map((providerId: string) => ({
                    provider_id: providerId,
                    skill_id: toId,
                })));
        }

        await admin.from('service_provider_skills').delete().eq('skill_id', fromId);

        const { error: markError } = await admin
            .from('service_skills')
            .update({ merged_into: toId })
            .eq('id', fromId);

        if (markError) {
            return NextResponse.json({ ok: false, error: markError.message }, { status: 500 });
        }

        // If the loser was flagged as regulated and the winner was not, the
        // flag has to survive the merge — otherwise merging "boiler repair"
        // into "boilers" is a way to launder a gas tag into an unrestricted
        // one. Checked rather than assumed, because the matcher may well have
        // caught one wording and not the other.
        const winnerConcept = to.regulated_concept
            || from.regulated_concept
            || regulatedConceptFor(to.label);

        if (winnerConcept && winnerConcept !== to.regulated_concept) {
            await admin
                .from('service_skills')
                .update({ regulated_concept: winnerConcept })
                .eq('id', toId);
        }

        return NextResponse.json({ ok: true, moved: toMove.length });
    } catch (err: any) {
        await logError('admin-skills-merge', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

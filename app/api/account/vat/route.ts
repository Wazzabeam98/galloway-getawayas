import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkVatSettings, formatVatNumber } from '@/lib/vat';

export const dynamic = 'force-dynamic';

// A host's (profiles) or a provider's (service_providers, ?providerId=) own VAT
// registration. The columns are private — no browser grant — so this route is
// the only reader and writer, with the service role, for the signed-in owner
// only. The check is lib/vat.ts, the same one the form runs as you type.

async function target(admin: any, userId: string, providerId: string | null) {
    if (!providerId) {
        const { data } = await admin
            .from('profiles')
            .select('id, full_name, vat_registered, vat_number, vat_name')
            .eq('id', userId)
            .maybeSingle();
        return data ? { table: 'profiles', id: data.id, row: data, suggestedName: data.full_name || '' } : null;
    }
    const { data } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, vat_registered, vat_number, vat_name')
        .eq('id', providerId)
        .maybeSingle();
    if (!data || data.owner_id !== userId) return null;
    return { table: 'service_providers', id: data.id, row: data, suggestedName: data.business_name || '' };
}

function shape(row: any, suggestedName: string) {
    return {
        registered: !!row.vat_registered,
        number: row.vat_number ? formatVatNumber(row.vat_number) : '',
        name: row.vat_name || '',
        suggestedName,
    };
}

export async function GET(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const providerId = new URL(request.url).searchParams.get('providerId');
    const t = await target(adminClient(), user.id, providerId);
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(shape(t.row, t.suggestedName));
}

export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const providerId = body.providerId ? String(body.providerId) : null;
    const admin = adminClient();
    const t = await target(admin, user.id, providerId);
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const checked = checkVatSettings({ registered: body.registered, number: body.number, name: body.name });
    if (!checked.ok) {
        return NextResponse.json({ error: checked.message, field: checked.field }, { status: 400 });
    }

    const { data, error } = await admin
        .from(t.table)
        .update({
            vat_registered: checked.value.registered,
            vat_number: checked.value.number,
            vat_name: checked.value.name,
        })
        .eq('id', t.id)
        .select('vat_registered, vat_number, vat_name')
        .single();
    if (error || !data) {
        return NextResponse.json({ error: 'Your VAT details could not be saved. Please try again.' }, { status: 500 });
    }
    return NextResponse.json(shape(data, t.suggestedName));
}

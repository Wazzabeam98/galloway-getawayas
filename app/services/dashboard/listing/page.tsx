export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { audienceForTrade } from '@/lib/serviceProviders';
import { isFoodProvider } from '@/lib/serviceOrders';
import { shapeOf } from '@/lib/serviceSlots';
import ProviderListingEditor from '@/components/services/ProviderListingEditor';

export const metadata = {
    title: 'Edit your listing',
    robots: { index: false, follow: false },
};

// The guest-experience provider's listing editor — the sectioned editor that
// OWNS edit. A provider opens a section, changes it, saves it; the wizard is now
// first-time create only. Approval is one-time: an approved provider edits freely
// and changes go live immediately, with no pending state and no re-review.
//
// Server-loaded via the admin client (the same private columns the editor needs —
// the collection address — are revoked from the browser role), ownership checked
// here and again on every save route.
export default async function ProviderListingPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const { data: providers } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, trade, custom_label, stripe_mcc, audience, status, shape, description, '
            + 'photos, headshot, logo, dietary_note, guest_details, fulfilment, '
            + 'collection_street, collection_town, collection_postcode, '
            + 'slot_length_minutes, slot_turnaround_minutes, slot_capacity, slot_min_people, '
            + 'lead_time_days, cancellation_window_hours, owner_paused')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

    // Cast: the select is built as a concatenated string, which defeats
    // supabase-js's typed-select inference — the reads are shaped by hand below.
    const list = (providers || []) as any[];
    // One provider = one listing: the approved row, else the most recent.
    const provider = list.find((p) => p.status === 'approved') || list[0];
    if (!provider) redirect('/services/dashboard');

    // The editor is the guest surface. A host trade edits elsewhere; a guest whose
    // row isn't approved yet is still in create — send them to the dashboard.
    if (!(provider.audience === 'guest' || audienceForTrade(provider.trade) === 'guest')) {
        redirect('/services/dashboard/edit');
    }

    const isSlot = shapeOf(provider) === 'slot';
    const [{ data: areas }, { data: items }, { data: avail }] = await Promise.all([
        admin.from('service_areas').select('label').eq('provider_id', provider.id).order('created_at', { ascending: true }),
        admin.from('service_provider_items').select('id, name, description, price, unit, image, duration_minutes, fulfilment, active, sort_order')
            .eq('provider_id', provider.id).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        isSlot
            ? admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', provider.id).order('day_of_week', { ascending: true })
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const gd = (provider.guest_details && typeof provider.guest_details === 'object') ? provider.guest_details : {};

    return (
        <ProviderListingEditor
            provider={{
                id: provider.id,
                shape: provider.shape,
                isSlot,
                isFood: isFoodProvider(provider),
                business_name: provider.business_name || '',
                category_label: provider.custom_label || '',
                // The picked category KEY (guest_details.category) — what the
                // editor needs to know whether this experience can travel.
                category: gd.category || '',
                description: provider.description || '',
                status: provider.status,
                owner_paused: provider.owner_paused === true,
                photos: provider.photos || [],
                headshot: provider.headshot || null,
                logo: provider.logo || null,
                dietary_note: provider.dietary_note || '',
                fulfilment: provider.fulfilment || '',
                collection_street: provider.collection_street || '',
                collection_town: provider.collection_town || '',
                collection_postcode: provider.collection_postcode || '',
                slot_length_minutes: provider.slot_length_minutes ?? null,
                slot_turnaround_minutes: provider.slot_turnaround_minutes ?? 0,
                slot_capacity: provider.slot_capacity ?? null,
                slot_min_people: provider.slot_min_people ?? 1,
                lead_time_days: provider.lead_time_days ?? 0,
                cancellation_window_hours: provider.cancellation_window_hours ?? 48,
                professional_title: gd.professional_title || '',
                years_experience: gd.years_experience || '',
                qualifications: gd.qualifications || '',
                recognition: gd.recognition || '',
                what_to_expect: gd.what_to_expect || '',
                itinerary: Array.isArray(gd.itinerary) ? gd.itinerary : [],
                min_age: gd.min_age ?? null,
                activity_level: gd.activity_level || '',
                what_to_bring: gd.what_to_bring || '',
                accessibility: gd.accessibility || '',
                parking: gd.parking || '',
                dietary_options: Array.isArray(gd.dietary_options) ? gd.dietary_options : [],
                areas: (areas || []).map((a: any) => a.label).filter(Boolean),
                items: (items || []).map((it: any) => ({
                    id: it.id, name: it.name || '', description: it.description || '',
                    price: Number(it.price), unit: it.unit || 'flat',
                    image: it.image || null,
                    duration_minutes: it.duration_minutes ?? null,
                    fulfilment: it.fulfilment || null,
                    active: it.active !== false,
                })),
                availability: (avail || []).map((a: any) => ({
                    day_of_week: Number(a.day_of_week), open_time: String(a.open_time).slice(0, 5), close_time: String(a.close_time).slice(0, 5),
                })),
            }}
        />
    );
}

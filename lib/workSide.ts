import { APPROVED_LISTING_STATUSES, NO_WORK_SIDE, WorkSide } from './workMode';

// Reads what a signed-in person can work as, with their own (RLS-bound)
// client: an owner can read their own listings and their own provider row
// whatever its state. Derived from the rows rather than a stored flag, so it
// can never fall out of step with reality.
export async function readWorkSide(supabase: any, userId: string | null | undefined): Promise<WorkSide & { providerAudience: string | null }> {
    if (!userId) return { ...NO_WORK_SIDE, providerAudience: null };

    const [anyListing, approvedListing, provider] = await Promise.all([
        // Drafts count for the switch: you're mid-way through becoming a host.
        supabase.from('listings').select('id', { count: 'exact', head: true }).eq('host_id', userId),
        supabase
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('host_id', userId)
            .in('status', APPROVED_LISTING_STATUSES),
        // Only a live provider: the dashboard bounces a draft back to the wizard.
        // The audience lets the menu show an experience provider their own sections.
        supabase
            .from('service_providers')
            .select('audience')
            .eq('owner_id', userId)
            .eq('status', 'approved')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    return {
        isHost: (anyListing.count || 0) > 0,
        isApprovedHost: (approvedListing.count || 0) > 0,
        isProvider: !!provider.data,
        providerAudience: (provider.data && provider.data.audience) || null,
    };
}

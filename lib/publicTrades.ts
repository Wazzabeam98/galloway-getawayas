import { HOST_TRADES, isTradeComingSoon } from '@/lib/serviceProviders';
import { visibleInDirectory } from '@/lib/serviceSubscription';

// The tradespeople a stranger can actually see: the profiles the /services
// list shows and /services/<trade>/<id> renders rather than redirecting.
// Read under the service role, so the private columns visibleInDirectory
// needs (owner_paused, admin_hidden_at) are there to check — the anon read the
// list does drops those rows in the database instead. Same rule, both ends.
//
// Used by the sitemap and by /services' own metadata (a directory with nobody
// in it is a thin page and is kept out of the index until someone is).
export interface PublicTrade { id: string; trade: string; approved_at: string | null; }

export async function loadPublicTrades(admin: any): Promise<PublicTrade[]> {
    const trades = (HOST_TRADES as readonly string[]).filter((t) => !isTradeComingSoon(t));
    const { data, error } = await admin
        .from('service_providers')
        .select('id, trade, status, subscription_status, owner_paused, admin_hidden_at, approved_at')
        .in('trade', trades)
        .eq('status', 'approved');
    if (error) throw error;
    return (data || [])
        .filter((p: any) => visibleInDirectory(p))
        .map((p: any) => ({ id: p.id, trade: p.trade, approved_at: p.approved_at || null }));
}

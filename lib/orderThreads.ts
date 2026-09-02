// The two parties to a guest experience order, and who the "other" is to the
// viewer — the same gate the order-thread RLS enforces, checked here so the
// service role can read the other side's name and stamp read_at.
//
// A thread hangs off a service_orders row. Its participants are the guest who
// placed it (service_orders.guest_id) and the owner of the provider it was
// placed with (service_providers.owner_id). Anyone else is not a participant
// and gets null, which the routes turn into a 403.

import { displayName } from '@/lib/utils';

export interface OrderThreadContext {
    order: {
        id: string;
        guest_id: string;
        provider_id: string;
        provider_business_name: string | null;
        item_name: string | null;
        service_date: string;
        status: string;
    };
    // The viewer is the guest (true) or the provider's owner (false).
    isGuest: boolean;
    // The OTHER party's user id, and the name to show the viewer for them: the
    // business name to a guest, the guest's chosen display name to the provider.
    otherId: string;
    otherName: string;
    business: string;
}

// The provider side of the inbox: the order threads for every provider this user
// owns, newest and unread first. Threads with an actual message only — an inbox
// of empty orders is noise; the provider starts one from their dashboard.
export interface OrderThreadListItem {
    orderId: string;
    otherName: string;
    subtitle: string;
    lastBody: string | null;
    lastAt: string | null;
    unread: number;
    ended: boolean;
}

export async function listProviderOrderThreads(admin: any, uid: string): Promise<OrderThreadListItem[]> {
    const { data: mine } = await admin.from('service_providers').select('id').eq('owner_id', uid);
    const provIds = (mine || []).map((p: any) => p.id);
    if (!provIds.length) return [];

    const { data: orders } = await admin
        .from('service_orders')
        .select('id, item_name, service_date, guest_name, status')
        .in('provider_id', provIds)
        .in('status', ['authorised', 'confirmed', 'cancelled', 'refunded']);
    const rows = orders || [];
    if (!rows.length) return [];

    const ids = rows.map((o: any) => o.id);
    const { data: msgs } = await admin
        .from('messages')
        .select('order_id, body, created_at, recipient_id, read_at')
        .in('order_id', ids)
        .order('created_at', { ascending: false });

    const last: Record<string, any> = {};
    const unread: Record<string, number> = {};
    for (const m of msgs || []) {
        if (!last[m.order_id]) last[m.order_id] = m;
        if (m.recipient_id === uid && !m.read_at) unread[m.order_id] = (unread[m.order_id] || 0) + 1;
    }

    const items: OrderThreadListItem[] = rows
        .filter((o: any) => last[o.id])
        .map((o: any) => ({
            orderId: o.id,
            otherName: o.guest_name || 'Guest',
            subtitle: (o.item_name || 'Experience') + (o.service_date ? ' · ' + String(o.service_date) : ''),
            lastBody: last[o.id] ? String(last[o.id].body) : null,
            lastAt: last[o.id] ? String(last[o.id].created_at) : null,
            unread: unread[o.id] || 0,
            ended: o.status === 'cancelled' || o.status === 'refunded',
        }));

    items.sort((a, b) => {
        if (a.unread !== b.unread) return b.unread - a.unread;
        return (b.lastAt || '') < (a.lastAt || '') ? -1 : 1;
    });
    return items;
}

export async function orderThreadContext(
    admin: any,
    orderId: string,
    userId: string
): Promise<OrderThreadContext | null> {
    const { data: order } = await admin
        .from('service_orders')
        .select('id, guest_id, provider_id, provider_business_name, item_name, service_date, status')
        .eq('id', orderId)
        .maybeSingle();
    if (!order) return null;

    const { data: prov } = await admin
        .from('service_providers')
        .select('owner_id, business_name')
        .eq('id', order.provider_id)
        .maybeSingle();
    if (!prov) return null;

    const isGuest = order.guest_id === userId;
    const isProvider = prov.owner_id === userId;
    if (!isGuest && !isProvider) return null;

    const business = order.provider_business_name || prov.business_name || 'the provider';

    let otherId: string;
    let otherName: string;
    if (isGuest) {
        otherId = prov.owner_id;
        otherName = business;
    } else {
        otherId = order.guest_id;
        // The guest named to the provider — through displayName, honouring the
        // show_full_name switch like everywhere else a person is named.
        const { data: guest } = await admin
            .from('profiles')
            .select('full_name, preferred_name, show_full_name')
            .eq('id', order.guest_id)
            .maybeSingle();
        otherName = displayName(guest, 'the guest');
    }

    return { order, isGuest, otherId, otherName, business };
}

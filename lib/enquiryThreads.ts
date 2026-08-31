// The two people on an enquiry thread, worked out once.
//
// A thread hangs off an accepted job (and stays after a cancel — that is
// exactly when there is something to sort out). The two participants are the
// enquiry's host and the owner of the provider it was sent to; nobody else,
// which is what the RLS on messages enforces and what this mirrors in code so
// the routes can authorise and name the other side.

export type EnquiryThreadContext = {
    enquiry: any;
    provider: any;
    isHost: boolean;
    isProvider: boolean;
    otherId: string;      // the person the viewer is talking to
    otherName: string;    // a business name when the viewer is the host
    viewerId: string;
};

// Returns the context if `uid` is a participant, else null. `admin` is a
// service-role client.
export async function enquiryThreadContext(
    admin: any,
    enquiryId: string,
    uid: string
): Promise<EnquiryThreadContext | null> {
    const { data: enquiry } = await admin
        .from('service_enquiries')
        .select('id, reference, trade, business_name, summary, status, preferred_date, window_from, window_to, host_id, host_name, provider_id, listing_id, cancelled_by, cancel_reason')
        .eq('id', enquiryId)
        .maybeSingle();
    if (!enquiry) return null;

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, contact_email')
        .eq('id', enquiry.provider_id)
        .maybeSingle();

    const isHost = enquiry.host_id === uid;
    const isProvider = !!provider && provider.owner_id === uid;
    if (!isHost && !isProvider) return null;

    // The host talks to a business; the tradesman talks to a person.
    const otherId = isHost ? (provider ? provider.owner_id : '') : enquiry.host_id;
    const otherName = isHost
        ? String((provider && provider.business_name) || enquiry.business_name || 'The tradesman')
        : String(enquiry.host_name || 'The host');

    return { enquiry, provider, isHost, isProvider, otherId, otherName, viewerId: uid };
}

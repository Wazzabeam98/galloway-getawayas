import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { londonDayKey } from '@/lib/dayKey';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getImageUrl, adminName } from '@/lib/utils';
import { publicArea } from '@/lib/places';
import AdminListingRow from '@/components/admin/AdminListingRow';
import ListingReviewQueue from '@/components/admin/ListingReviewQueue';
import { publishProblems, fromRow } from '@/lib/listingRules';
import { propertyTypeLabel } from '@/lib/propertyTypes';
import { waitedFor } from '@/lib/email';
import { listingsWithPaidRecords, removalFor } from '@/lib/listingRemoval';
import { listingContactProblems } from '@/lib/listingContact';

// "Flat in Kirkcudbright" — the guest card's line, so admin reads a listing's
// type the way a guest will. Just the area when no type was picked.
function typeLine(type: string | null | undefined, area: string): string {
    const t = propertyTypeLabel(type);
    return t ? (area ? `${t} in ${area}` : t) : area;
}

export const dynamic = 'force-dynamic';

// Every listing on the site, whoever owns it, with the one control that
// matters in a hurry: take it down.
//
// The editor is where a considered change is made. This page exists because
// "off the public site within a minute" and "open a nine-section form" are not
// the same job.
export default async function AdminListings() {
    const supabase = createServerComponentClient({ cookies });
    // One rule, in lib/access. It was written out nine times, byte for
    // byte, and every copy was correct — but nothing made the tenth so.
    const authUser = await requireAdmin();
    const myId = authUser.id;
    const admin = adminClient();

    // Service role: bookings and profiles are behind row-level security, and
    // the counts below would come back empty read as the signed-in user.
    //
    // The error is checked rather than discarded. Without this a failing
    // service-role key returns null, `rows` falls back to [], and the page
    // says "No listings yet" — which reads as an empty site rather than a
    // broken key, and is a lie in the one place that must not tell them.
    const { data: listings, error: listingsError } = await admin
        .from('listings')
        .select('id, title, location, images, status, host_id, created_at, property_type, street_address, postcode, price_per_night, max_guests, bedrooms, beds, bathrooms, amenities, description, neighbourhood, additional_rules, checkout_note, check_in_method, weekend_price, is_luxury')
        .order('created_at', { ascending: false });

    if (listingsError) {
        return (
            <div className="max-w-3xl mx-auto px-6 py-10">
                <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                    &larr; Owner tools
                </Link>
                <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-2">All listings</h1>
                <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
                    <div className="font-bold text-red-900">The listings could not be read</div>
                    <p className="text-sm text-red-900 mt-1">
                        This is not an empty site — the database refused the request.
                    </p>
                    <p className="text-sm text-red-900 mt-2 font-mono break-all">{listingsError.message}</p>
                    <p className="text-xs text-red-800 mt-3">
                        &ldquo;Invalid API key&rdquo; here means SUPABASE_SERVICE_ROLE_KEY does not belong to
                        the project NEXT_PUBLIC_SUPABASE_URL points at, for this environment.
                    </p>
                </div>
            </div>
        );
    }

    const rows = listings || [];
    const hostIds = Array.from(new Set(rows.map((l) => l.host_id)));

    const { data: hosts } = hostIds.length
        ? await admin.from('profiles').select('id, full_name, first_name, last_name, preferred_name, show_full_name').in('id', hostIds)
        : { data: [] };

    const hostName: Record<string, string> = {};
    (hosts || []).forEach((h: any) => {
        // The owner's own view, so the real name rather than what guests see.
        hostName[h.id] = adminName(h, 'Host');
    });

    // Live bookings per listing, so nobody hides a property without knowing
    // there are guests already holding a stay on it.
    const { data: live } = await admin
        .from('bookings')
        .select('listing_id')
        .eq('status', 'confirmed')
        .gte('check_out', londonDayKey());

    const liveCount: Record<string, number> = {};
    (live || []).forEach((b: any) => {
        liveCount[b.listing_id] = (liveCount[b.listing_id] || 0) + 1;
    });

    // Which listings Remove would only take down (a paid booking or order —
    // the record must survive) and which it would delete. The rule the host's
    // own Delete uses. A failed read falls back to "take down" for every row,
    // never to "delete".
    let paidIds: Set<string>;
    try {
        paidIds = await listingsWithPaidRecords(admin, rows.map((l) => l.id));
    } catch {
        paidIds = new Set(rows.map((l) => l.id));
    }

    // CONTACT DETAILS IN A LISTING (lib/listingContact). The editor and the
    // wizard now refuse them, but a listing written before the rule may still
    // carry an email, a phone number, a web address or a handle — in its
    // title, description, house rules, neighbourhood, checkout note or
    // directions. Read here so each one is flagged, here and in the queue.
    // Only the directions from listing_arrival — never the wifi password or a
    // door code. A failed read flags nothing from the directions rather than
    // failing the page.
    const { data: arrivals } = rows.length
        ? await admin.from('listing_arrival').select('listing_id, arrival_directions').in('listing_id', rows.map((l) => l.id))
        : { data: [] };
    const directionsFor: Record<string, string | null> = {};
    (arrivals || []).forEach((a: any) => { directionsFor[a.listing_id] = a.arrival_directions; });
    const contactFlags: Record<string, string[]> = {};
    rows.forEach((l: any) => {
        const found = listingContactProblems({ ...l, arrival_directions: directionsFor[l.id] ?? null });
        if (found.length) contactFlags[l.id] = found.map((p) => p.label);
    });
    const flagged = rows.filter((l) => contactFlags[l.id]);

    const { data: recent } = await admin
        .from('admin_actions')
        .select('id, action, listing_id, reason, created_at, admin_id, detail')
        .order('created_at', { ascending: false })
        .limit(20);

    const published = rows.filter((l) => l.status === 'published');
    const hidden = rows.filter((l) => l.status === 'hidden');
    const drafts = rows.filter((l) => l.status === 'draft');
    // Counted separately and first, because it is the only one of these that
    // is somebody waiting on us. Nothing writes this status yet — the count
    // reads zero until publishing moves to the server, at which point this is
    // the queue, and it is deliberately visible before it can fill up.
    const waiting = rows.filter((l) => l.status === 'pending_review');

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">All listings</h1>
            <p className="text-sm text-slate-500 mb-2">
                Every property on the site. Hiding one takes it off search and stops new
                bookings straight away.
            </p>
            <p className="text-sm text-slate-500 mb-8">
                Bookings already made are never touched — a guest who has paid still has
                their stay, and the host still has to honour it.
            </p>

            <div className="flex flex-wrap gap-4 text-sm mb-8">
                {waiting.length > 0 && (
                    <span className="text-sky-900 font-semibold">
                        {waiting.length} waiting for approval
                    </span>
                )}
                <span className="text-slate-800 font-semibold">{published.length} live</span>
                <span className="text-slate-500">{hidden.length} hidden</span>
                <span className="text-slate-500">{drafts.length} draft</span>
            </div>

            {/* The queue first, because it is the only part of this page that
                is somebody waiting on us. Everything below is reference. */}
            <ListingReviewQueue
                items={waiting.map((l) => ({
                    id: l.id,
                    title: l.title || 'Untitled listing',
                    area: typeLine(l.property_type, publicArea(l.location)),
                    image: l.images && l.images.length ? getImageUrl(l.images[0]) : null,
                    hostName: hostName[l.host_id] || 'Host',
                    // The wizard's own rules, so the queue and the form cannot
                    // disagree about what "finished" means.
                    problems: publishProblems(fromRow(l)).map((p) => p.message)
                        // The title and description are a publish rule already;
                        // the other fields are named here so nothing goes live
                        // with a number in its house rules.
                        .concat(contactFlags[l.id] && !publishProblems(fromRow(l)).some((p) => p.key === 'contact_details')
                            ? ['Contact details in its ' + contactFlags[l.id].join(', ') + '.']
                            : []),
                    waitingSince: waitedFor(l.created_at),
                }))}
            />

            {flagged.length > 0 && (
                <section className="mb-10 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
                    <h2 className="text-lg font-bold text-amber-950">
                        Contact details in {flagged.length === 1 ? '1 listing' : flagged.length + ' listings'}
                    </h2>
                    <p className="text-sm text-amber-900 mt-1 mb-4">
                        An email, phone number, web address or social handle that a guest can read.
                        Hosts can no longer save these; listings written before the rule need them taken out.
                    </p>
                    <ul className="divide-y divide-amber-200">
                        {flagged.map((l) => (
                            <li key={l.id} className="py-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                <span>
                                    <span className="font-semibold text-slate-900">{l.title || 'Untitled listing'}</span>
                                    <span className="text-slate-600"> — {hostName[l.host_id] || 'Host'} · {l.status} · in its {contactFlags[l.id].join(', ')}</span>
                                </span>
                                <Link href={'/edit-listing/' + l.id} className="font-semibold text-slate-900 underline">
                                    Open editor
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="space-y-3">
                {rows.map((l) => (
                    <AdminListingRow
                        key={l.id}
                        id={l.id}
                        title={l.title || 'Untitled listing'}
                        area={typeLine(l.property_type, publicArea(l.location))}
                        image={l.images && l.images.length ? getImageUrl(l.images[0]) : null}
                        status={l.status}
                        hostName={hostName[l.host_id] || 'Host'}
                        isMine={l.host_id === myId}
                        liveBookings={liveCount[l.id] || 0}
                        removal={removalFor(paidIds.has(l.id))}
                        luxury={(l as any).is_luxury === true}
                    />
                ))}
                {!rows.length && (
                    <p className="text-sm text-slate-500">No listings yet.</p>
                )}
            </div>

            <h2 className="text-lg font-bold text-slate-900 mt-12 mb-1">Recent owner actions</h2>
            <p className="text-xs text-slate-500 mb-4">
                Only actions on listings that were not yours. Your own listings go through
                the ordinary host controls.
            </p>

            {(recent || []).length ? (
                <div className="border rounded-2xl divide-y">
                    {(recent || []).map((a: any) => {
                        const listing = rows.find((l) => l.id === a.listing_id);
                        return (
                            <div key={a.id} className="p-4 text-sm">
                                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                    <span className="font-semibold text-slate-900">
                                        {a.action.replace('listing_', '').replace('_', ' ')}
                                        {' — '}
                                        {listing
                                            ? listing.title || 'Untitled listing'
                                            : (a.detail && a.detail.title) || 'a since-deleted listing'}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                        {new Date(a.created_at).toLocaleString('en-GB')}
                                    </span>
                                </div>
                                <p className="text-slate-600 mt-1">{a.reason}</p>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-slate-500">Nothing yet.</p>
            )}
        </div>
    );
}

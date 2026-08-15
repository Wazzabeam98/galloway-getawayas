'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import {
    Wrench,
    Droplet,
    Sparkles,
    Trees,
    AlertTriangle,
} from 'lucide-react';

interface Service {
    id: string;
    name: string;
    description: string;
    price_note: string;
    icon: string;
}

interface RequestRow {
    id: string;
    service_id: string | null;
    listing_id: string | null;
    preferred_date: string | null;
    notes: string;
    status: string;
    created_at: string;
}

const ICONS: Record<string, any> = {
    wrench: Wrench,
    droplet: Droplet,
    sparkles: Sparkles,
    trees: Trees,
    alert: AlertTriangle,
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
    new: { label: 'Requested', className: 'bg-amber-50 text-amber-800' },
    scheduled: { label: 'Scheduled', className: 'bg-emerald-50 text-emerald-800' },
    completed: { label: 'Completed', className: 'bg-slate-100 text-slate-700' },
    cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500' },
};

export default function ServicesPage() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [services, setServices] = useState<Service[]>([]);
    const [listings, setListings] = useState<{ id: string; title: string }[]>([]);
    const [requests, setRequests] = useState<RequestRow[]>([]);

    const [openFor, setOpenFor] = useState<Service | null>(null);
    const [listingId, setListingId] = useState('');
    const [preferredDate, setPreferredDate] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session?.user) {
                setLoading(false);
                return;
            }

            const { data: svc } = await supabase
                .from('services')
                .select('id, name, description, price_note, icon')
                .eq('active', true)
                .order('sort_order', { ascending: true });
            setServices(svc || []);

            const { data: mine } = await supabase
                .from('listings')
                .select('id, title')
                .eq('host_id', session.user.id)
                .order('created_at', { ascending: true });
            setListings(mine || []);

            const { data: reqs } = await supabase
                .from('service_requests')
                .select('id, service_id, listing_id, preferred_date, notes, status, created_at')
                .eq('host_id', session.user.id)
                .order('created_at', { ascending: false });
            setRequests(reqs || []);

            setLoading(false);
        };

        load();
    }, [supabase]);

    const openRequest = (service: Service) => {
        setOpenFor(service);
        setListingId(listings.length === 1 ? listings[0].id : '');
        setPreferredDate('');
        setNotes('');
    };

    const submitRequest = async () => {
        if (!session?.user || !openFor) return;
        setSubmitting(true);

        const { data, error } = await supabase
            .from('service_requests')
            .insert({
                host_id: session.user.id,
                service_id: openFor.id,
                listing_id: listingId || null,
                preferred_date: preferredDate || null,
                notes: notes.trim(),
            })
            .select('id, service_id, listing_id, preferred_date, notes, status, created_at')
            .single();

        setSubmitting(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        if (data) setRequests((prev) => [data].concat(prev));
        setOpenFor(null);
        toast.success("Request sent — we'll be in touch to confirm a time.", { theme: 'colored' });
    };

    const cancelRequest = async (id: string) => {
        const { error } = await supabase
            .from('service_requests')
            .update({ status: 'cancelled' })
            .eq('id', id);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setRequests((prev) =>
            prev.map((r) => (r.id === id ? Object.assign({}, r, { status: 'cancelled' }) : r))
        );
    };

    const serviceName = (id: string | null) => {
        const s = services.filter((x) => x.id === id)[0];
        return s ? s.name : 'Service';
    };

    const listingTitle = (id: string | null) => {
        const l = listings.filter((x) => x.id === id)[0];
        return l ? l.title : null;
    };

    if (loading) {
        return (
            <div className="max-w-5xl mx-auto px-6 py-16">
                <div className="h-8 w-56 bg-slate-100 rounded animate-pulse mb-4" />
                <div className="h-4 w-80 bg-slate-100 rounded animate-pulse" />
            </div>
        );
    }

    if (!session?.user) {
        return (
            <div className="max-w-5xl mx-auto px-6 py-16 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Services</h1>
                <p className="text-slate-600">Please log in to request a service.</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-6 py-10">
            <h1 className="text-3xl font-bold text-slate-900 mb-1">Services</h1>
            <p className="text-slate-600 mb-8">
                Looking after a holiday let is the hard part. We can take some of it off your hands.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
                {services.map((service) => {
                    const Icon = ICONS[service.icon] || Wrench;
                    return (
                        <div key={service.id} className="border rounded-2xl p-5 flex flex-col">
                            <Icon className="w-6 h-6 text-emerald-700 mb-3" strokeWidth={1.5} />
                            <h2 className="font-semibold text-slate-900 mb-1">{service.name}</h2>
                            <p className="text-sm text-slate-600 flex-1">{service.description}</p>
                            <div className="flex items-center justify-between mt-4 pt-4 border-t">
                                <span className="text-sm font-semibold text-slate-900">
                                    {service.price_note}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => openRequest(service)}
                                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg"
                                >
                                    Request
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {services.length === 0 && (
                <div className="border rounded-2xl p-10 text-center mb-12">
                    <p className="text-slate-500 text-sm">No services listed yet.</p>
                </div>
            )}

            <h2 className="text-xl font-bold text-slate-900 mb-4">Your requests</h2>

            {requests.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <p className="text-slate-500 text-sm">
                        Nothing requested yet. Pick a service above and we&apos;ll get back to you.
                    </p>
                </div>
            ) : (
                <div className="border rounded-2xl divide-y">
                    {requests.map((req) => {
                        const status = STATUS_LABELS[req.status] || STATUS_LABELS.new;
                        const place = listingTitle(req.listing_id);
                        return (
                            <div key={req.id} className="p-5 flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 text-sm">
                                        {serviceName(req.service_id)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        {place ? `${place} · ` : ''}
                                        {req.preferred_date
                                            ? `Preferred: ${new Date(req.preferred_date).toLocaleDateString('en-GB', {
                                                  day: 'numeric',
                                                  month: 'long',
                                              })}`
                                            : 'No date given'}
                                    </div>
                                    {req.notes && (
                                        <p className="text-xs text-slate-500 mt-2 whitespace-pre-line">{req.notes}</p>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.className}`}>
                                        {status.label}
                                    </span>
                                    {req.status === 'new' && (
                                        <button
                                            type="button"
                                            onClick={() => cancelRequest(req.id)}
                                            className="text-xs text-slate-500 hover:text-red-600"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {openFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
                        <div className="flex items-start justify-between mb-1">
                            <h3 className="text-xl font-bold text-slate-900">{openFor.name}</h3>
                            <button
                                type="button"
                                onClick={() => setOpenFor(null)}
                                aria-label="Close"
                                className="text-slate-400 hover:text-slate-800 text-xl leading-none"
                            >
                                &times;
                            </button>
                        </div>
                        <p className="text-sm text-slate-500 mb-5">{openFor.price_note}</p>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-500">Which property?</label>
                                <select
                                    value={listingId}
                                    onChange={(e) => setListingId(e.target.value)}
                                    className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                >
                                    <option value="">Choose a property</option>
                                    {listings.map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.title || 'Untitled listing'}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs text-slate-500">Preferred date</label>
                                <input
                                    type="date"
                                    value={preferredDate}
                                    onChange={(e) => setPreferredDate(e.target.value)}
                                    className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                />
                                <p className="text-xs text-slate-400 mt-1">
                                    We&apos;ll confirm the actual time with you — check your calendar for a gap
                                    between bookings.
                                </p>
                            </div>

                            <div>
                                <label className="text-xs text-slate-500">Anything we should know?</label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={4}
                                    placeholder="Key safe code, where the stopcock is, what's gone wrong..."
                                    className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between mt-6">
                            <button
                                type="button"
                                onClick={() => setOpenFor(null)}
                                className="text-sm font-semibold underline text-slate-700 hover:text-black"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitRequest}
                                disabled={submitting || !listingId}
                                className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {submitting ? 'Sending...' : 'Send request'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

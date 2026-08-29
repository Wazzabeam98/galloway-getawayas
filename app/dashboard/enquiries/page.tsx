'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Phone, Mail } from 'lucide-react';
import { tradeLabel } from '@/lib/serviceProviders';
import {
    hostStatusSummary,
    contactReleased,
    canWithdraw,
    faultLabels,
    snapshotLine,
    requestedWhen,
    OUTCOMES,
    outcomeLabel,
} from '@/lib/serviceEnquiries';

// What a host has asked, and what came back.
//
// WHAT THIS SCREEN REFUSES TO SAY
//
// That anybody is coming. One enquiry goes to one tradesman and nothing fans
// out, so silence is the likeliest way this fails — and a screen that reads
// "on their way" while nothing has happened is how a host finds that out on
// the worst possible morning. 'Sent' says sent. 'Opened' says opened. Only
// 'Accepted' says somebody agreed to anything, and it is the only state that
// shows a phone number.
//
// The words themselves live in hostStatusSummary, next to the values they come
// from, so this page and the emails cannot drift apart.
//
// IT SETTLES ITS OWN ROWS BEFORE IT READS THEM
//
// An emergency waits twenty minutes and the cron sweeps every five, so a host
// refreshing at minute twenty-one could otherwise be looking at "waiting" when
// the number was already due. On the one case whose entire design is about
// minutes, that is the least forgivable place for a stale screen. So the page
// asks the server to settle this host's own rows first, then reads them.
//
// Nothing is emailed by that call — they are looking at the screen and it has
// just changed. The cron still sends, for the host who is not looking.

interface Enquiry {
    id: string;
    reference: string;
    trade: string;
    business_name: string;
    provider_id: string;
    status: string;
    urgency: string;
    summary: string;
    fault_keys: string[];
    price_snapshot: any;
    preferred_date: string | null;
    window_from: string | null;
    window_to: string | null;
    outcome: string | null;
    sent_at: string;
    expires_at: string | null;

    // Copied onto the row by the respond route at the moment of acceptance,
    // and null until then. The host's screen therefore never reads
    // service_providers for a contact detail — which is what allows those
    // columns to be revoked from every browser role. See
    // 20260828202340_contact_details_are_not_public.sql.
    provider_phone: string | null;
    provider_email: string | null;
}

export default function EnquiriesPage() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [rows, setRows] = useState<Enquiry[]>([]);

    const load = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);

        if (!session?.user) { setLoading(false); return; }

        // Settle first, read second. A row whose twenty minutes ran out while
        // the host was on another tab has to be released before this query
        // runs, or the number they were promised is one refresh away.
        try {
            await fetch('/api/services/enquiries/refresh', { method: 'POST' });
        } catch {
            // A failed settle shows a slightly stale list, which the cron
            // fixes within five minutes. It must never stop the page loading.
        }

        const { data } = await supabase
            .from('service_enquiries')
            .select('id, reference, trade, business_name, provider_id, status, urgency, summary, fault_keys, price_snapshot, preferred_date, window_from, window_to, outcome, sent_at, expires_at, provider_phone, provider_email')
            .eq('host_id', session.user.id)
            .order('sent_at', { ascending: false });

        const list = (data || []) as Enquiry[];
        setRows(list);

        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const withdraw = async (id: string) => {
        const res = await fetch('/api/services/enquiries/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        const json = await res.json();

        if (!json.ok) {
            toast.error(json.error || 'Could not withdraw that.', { theme: 'colored' });
            return;
        }
        load();
    };

    // Self-reported, gating nothing, billed on nothing — which is exactly why
    // it is safe to ask for and why the browser may write it directly.
    const recordOutcome = async (id: string, outcome: string) => {
        const { error } = await supabase
            .from('service_enquiries')
            .update({
                outcome,
                outcome_at: new Date().toISOString(),
                outcome_by: session?.user?.id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        load();
    };

    if (loading) {
        return <p className="max-w-3xl mx-auto px-4 py-12 text-slate-500">Loading…</p>;
    }

    if (!session?.user) {
        return (
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
                <p className="text-slate-600">Sign in to see your enquiries.</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Your enquiries</h1>

            {rows.length === 0 && (
                <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                    <p className="font-semibold text-slate-900">Nothing yet.</p>
                    <p className="text-sm text-slate-600 mt-2">
                        <Link href="/services/property" className="text-emerald-700 font-semibold underline">
                            Find a tradesman
                        </Link>{' '}
                        who covers your property.
                    </p>
                </div>
            )}

            <div className="mt-8 space-y-4">
                {rows.map((row) => {
                    const summary = hostStatusSummary(row.status, row.business_name, row);
                    const asked = requestedWhen(row);
                    // Off the row, not off the provider. There is nothing to
                    // fetch and nothing this screen could fetch if it tried.
                    const contact = { contact_phone: row.provider_phone, contact_email: row.provider_email };
                    const faults = faultLabels(row.fault_keys);
                    const price = snapshotLine(row.price_snapshot);

                    return (
                        <div key={row.id} className="rounded-2xl border border-slate-300 p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="font-bold text-slate-900">{row.business_name}</h2>
                                    <p className="text-sm text-slate-500">
                                        {tradeLabel(row.trade)} · {row.reference}
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                    {summary.label}
                                </span>
                            </div>

                            <p className="text-sm text-slate-600 mt-3">{summary.detail}</p>

                            <p className="text-sm text-slate-500 mt-3 italic">{row.summary}</p>

                            {/* "Asked for", never a bare date under a heading
                                that could be read as a confirmed appointment.
                                See requestedWhen. */}
                            {asked && (
                                <p className="text-xs text-slate-500 mt-1">{asked}</p>
                            )}

                            {faults.length > 0 && (
                                <p className="text-xs text-slate-500 mt-1">{faults.join(' · ')}</p>
                            )}
                            {price && <p className="text-xs text-slate-500 mt-1">{price}</p>}

                            {contactReleased(row.status) && contact && (
                                <div className="mt-4 rounded-xl bg-emerald-50 p-4 space-y-1.5">
                                    {contact.contact_phone && (
                                        <a
                                            href={'tel:' + String(contact.contact_phone).replace(/\s/g, '')}
                                            className="flex items-center gap-2 font-semibold text-emerald-900"
                                        >
                                            <Phone className="w-4 h-4" strokeWidth={1.75} />
                                            {contact.contact_phone}
                                        </a>
                                    )}
                                    {contact.contact_email && (
                                        <a
                                            href={'mailto:' + contact.contact_email}
                                            className="flex items-center gap-2 text-sm text-emerald-900"
                                        >
                                            <Mail className="w-4 h-4" strokeWidth={1.75} />
                                            {contact.contact_email}
                                        </a>
                                    )}
                                </div>
                            )}

                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                {canWithdraw(row.status) && (
                                    <button
                                        onClick={() => withdraw(row.id)}
                                        className="text-sm text-slate-500 underline hover:text-slate-700"
                                    >
                                        Withdraw
                                    </button>
                                )}

                                {(row.status === 'declined' || row.status === 'expired') && (
                                    <Link
                                        href={'/services/' + row.trade}
                                        className="text-sm text-emerald-700 font-semibold underline"
                                    >
                                        See who else covers you
                                    </Link>
                                )}

                                {contactReleased(row.status) && !row.outcome && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm text-slate-500">How did it go?</span>
                                        {OUTCOMES.map((o) => (
                                            <button
                                                key={o.key}
                                                onClick={() => recordOutcome(row.id, o.key)}
                                                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:border-emerald-700"
                                            >
                                                {o.label}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {row.outcome && (
                                    <span className="text-sm text-slate-500">
                                        {outcomeLabel(row.outcome)}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

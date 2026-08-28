import { createHash } from 'crypto';
import { adminClient } from '@/lib/supabaseAdmin';
import { markViewed } from '@/lib/serviceEnquiryAlert';
import { tradeLabel } from '@/lib/serviceProviders';
import {
    faultLabels,
    snapshotLine,
    urgencyLabel,
    canRespond,
} from '@/lib/serviceEnquiries';
import EnquiryReply from '@/components/services/EnquiryReply';

export const dynamic = 'force-dynamic';

// What a tradesman sees when he presses the link in his email.
//
// NO SIGN-IN, ON PURPOSE
//
// There is no provider-facing page on this site to sign in to, and a roofer
// answering from a van would not sign in if there were. The token in the link
// is the whole mechanism.
//
// OPENING IT ANSWERS NOTHING
//
// This page marks the enquiry opened, which is true and harmless, and that is
// all it writes. The answer is a POST from the buttons below — because mail
// scanners, corporate filters and link previewers fetch every URL in an email
// before a person reads a word of it, and a GET that accepts an enquiry gets
// accepted by a virus scanner at four in the morning.
//
// The address is not shown until he says yes. What is shown is enough to
// decide: the trade, the town, what is wrong, and his own published prices
// quoted back at him.
export default async function EnquiryReplyPage({ params }: { params: { token: string } }) {
    const admin = adminClient();
    const hash = createHash('sha256').update(String(params.token || '')).digest('hex');

    const { data: enquiry } = await admin
        .from('service_enquiries')
        .select('*')
        .eq('reply_token_hash', hash)
        .maybeSingle();

    if (!enquiry) {
        return (
            <Frame title="That link has expired">
                <p className="text-slate-600">
                    This one has been dealt with, or it ran out of time and the owner was told to try
                    somebody else. Nothing more to do.
                </p>
            </Frame>
        );
    }

    const open = canRespond(String(enquiry.status || ''));
    if (open) await markViewed(String(enquiry.id));

    let listing: any = null;
    if (enquiry.listing_id) {
        const { data } = await admin
            .from('listings')
            .select('id, location')
            .eq('id', enquiry.listing_id)
            .maybeSingle();
        listing = data;
    }

    const faults = faultLabels(enquiry.fault_keys);
    const price = snapshotLine(enquiry.price_snapshot);

    if (!open) {
        return (
            <Frame title="Already dealt with">
                <p className="text-slate-600">
                    You have already answered this one, or it ran out of time. Reference{' '}
                    {enquiry.reference}.
                </p>
            </Frame>
        );
    }

    return (
        <Frame title={'A ' + tradeLabel(String(enquiry.trade)).toLowerCase() + ' job in ' + (listing?.location || enquiry.area_key || 'Dumfries & Galloway')}>
            <p className="text-sm text-slate-500">Reference {enquiry.reference}</p>

            <div className="my-6 rounded-xl bg-slate-50 border-l-4 border-emerald-700 p-4 text-slate-800">
                {enquiry.summary}
            </div>

            <dl className="space-y-2 text-sm">
                <Row label="How urgent" value={urgencyLabel(String(enquiry.urgency))} />
                {faults.length > 0 && <Row label="What's wrong" value={faults.join(', ')} />}
                {enquiry.when_note && <Row label="When suits" value={enquiry.when_note} />}
                {price && <Row label="Your published prices" value={price} />}
            </dl>

            <p className="text-sm text-slate-500 mt-6">
                We pass your name, number and email to them if you say yes — sent to your registered
                address, not to this screen. Nothing is taken from the job.
            </p>

            <EnquiryReply token={String(params.token)} />
        </Frame>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-900 font-semibold text-right">{value}</dd>
        </div>
    );
}

function Frame({ title, children }: { title: string; children: any }) {
    return (
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-12 pb-24">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mb-4">{title}</h1>
            {children}
        </div>
    );
}

import { adminClient } from '@/lib/supabaseAdmin';
import { hashBillingToken } from '@/lib/serviceBillingToken';
import { SUBSCRIPTION_MONTHLY, TRIAL_DAYS, tradeLabel } from '@/lib/serviceProviders';
import { hasCard, GRACE_DAYS } from '@/lib/serviceSubscription';
import BillingStart from '@/components/services/BillingStart';

export const dynamic = 'force-dynamic';

// What a tradesman sees when he presses "add a card" in his email.
//
// NO SIGN-IN, ON PURPOSE — the same reasoning as the enquiry reply page beside
// it. There is nowhere for a provider to sign in, and the man being asked for
// £20 a month is often up a ladder.
//
// OPENING IT STARTS NOTHING. This page reads and renders. The subscription is
// a POST from the button, because link previewers and mail scanners fetch
// every URL in an email before a person reads it.
//
// WHAT IS SHOWN, AND WHY IT IS THIS AND NOT MORE
//
// What he is agreeing to, what it costs, and when the first payment lands. The
// date is the one thing he will check against the email, so it is read from
// the same column the email counted back from rather than recomputed.
function formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
}

export default async function BillingPage({
    params,
    searchParams,
}: {
    params: { token: string };
    searchParams?: { done?: string };
}) {
    const admin = adminClient();

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, business_name, trade, plan, status, trial_ends_at, stripe_subscription_id, subscription_status')
        .eq('billing_token_hash', hashBillingToken(String(params.token || '')))
        .maybeSingle();

    if (!provider) {
        return (
            <Frame title="That link is not valid">
                <p className="text-slate-600">
                    It may have been replaced by a newer one. Check the most recent email we sent
                    you, or reply to it and we will sort it out.
                </p>
            </Frame>
        );
    }

    const name = String(provider.business_name || 'Your business');

    // Back from Stripe, or set up on a previous visit. The webhook is what
    // actually records the subscription, and it may be a second or two behind
    // the redirect — so a `?done=1` with nothing recorded yet is reported as
    // success rather than as a failure. Telling a man who has just typed his
    // card in that nothing happened is how you get rung up.
    const back = searchParams && searchParams.done === '1';

    if (back || hasCard(provider)) {
        return (
            <Frame title="You are all set">
                <p className="text-slate-600">
                    Thanks — <strong>{name}</strong> is set up to pay £{SUBSCRIPTION_MONTHLY} a
                    month.
                </p>
                {provider.trial_ends_at ? (
                    <p className="text-slate-600 mt-4">
                        Nothing is taken until{' '}
                        <strong>{formatDate(String(provider.trial_ends_at))}</strong>, when your
                        free period ends. You keep every day of it.
                    </p>
                ) : null}
                <p className="text-slate-500 text-sm mt-6">
                    Your card is held by Stripe, not by us. Reply to any of our emails to change or
                    cancel it.
                </p>
            </Frame>
        );
    }

    if (String(provider.plan || '') !== 'subscription') {
        return (
            <Frame title="There is nothing to pay">
                <p className="text-slate-600">
                    {name} is on our commission model — 10% of a job when you accept one through the
                    site, and nothing at all when you do not. There is no subscription to set up.
                </p>
            </Frame>
        );
    }

    const ends = provider.trial_ends_at ? new Date(String(provider.trial_ends_at)) : null;
    const over = !!ends && ends.getTime() <= Date.now();

    return (
        <Frame title={over ? 'Your free period has ended' : 'Your free period is nearly up'}>
            <p className="text-slate-600">
                <strong>{name}</strong> has been listed as a{' '}
                {String(tradeLabel(String(provider.trade || '')) || 'trade').toLowerCase()} on
                Galloway Getaways.
            </p>

            {ends ? (
                <p className="text-slate-600 mt-4">
                    {over ? (
                        <>
                            Your {TRIAL_DAYS} free days ran to{' '}
                            <strong>{formatDate(String(provider.trial_ends_at))}</strong>. Your
                            listing stays up for {GRACE_DAYS} days after that while you sort this
                            out, and comes down afterwards.
                        </>
                    ) : (
                        <>
                            Your {TRIAL_DAYS} free days run to{' '}
                            <strong>{formatDate(String(provider.trial_ends_at))}</strong>.{' '}
                            <strong>Nothing is taken before then</strong> — add a card now and you
                            keep every remaining day of it.
                        </>
                    )}
                </p>
            ) : null}

            <dl className="mt-6 space-y-2 text-sm">
                <Row label="What it costs" value={'£' + SUBSCRIPTION_MONTHLY + ' a month'} />
                <Row label="Commission on your work" value="None — you quote and get paid direct" />
                <Row
                    label="First payment"
                    value={ends && !over ? formatDate(String(provider.trial_ends_at)) : 'When your free period ends'}
                />
            </dl>

            <BillingStart token={String(params.token)} monthly={SUBSCRIPTION_MONTHLY} />
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

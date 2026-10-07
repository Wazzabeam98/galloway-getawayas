import PayoutSetupButton from '@/components/services/PayoutSetupButton';
import { formatGBP } from '@/lib/formatMoney';
import type { HeldSummary } from '@/lib/heldPayouts';

// The provider's "money is waiting" notice, Airbnb's shape: you're live and
// bookable, your share is held until your payouts are set up, here's how much
// and the one button that fixes it. Shown on the bookings home and the calendar
// while an approved provider's Stripe payouts are off. The figures are
// lib/heldPayouts — the same the reminder emails and the admin list use.
export default function HeldPayoutsBanner({ providerId, held, connected }: {
    providerId: string;
    held: HeldSummary | null;
    // A Stripe account exists but isn't finished — "Finish" rather than "Set up".
    connected?: boolean;
}) {
    const waiting = held ? held.waiting : 0;
    const upcoming = held ? held.upcoming : 0;
    const heading = waiting > 0
        ? `${formatGBP(waiting)} is waiting for you`
        : upcoming > 0
            ? `We’re holding ${formatGBP(upcoming)} for you`
            : 'Set up payouts so we can pay you';

    return (
        <div role="status" className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <p className="text-lg font-bold text-amber-950">{heading}</p>
            <p className="mt-1 text-sm text-amber-900/90">
                {waiting > 0 && upcoming > 0
                    ? `That’s from bookings that have already happened, with ${formatGBP(upcoming)} more from bookings still to come. `
                    : waiting > 0
                        ? 'That’s from bookings that have already happened. '
                        : upcoming > 0
                            ? 'That’s your share of bookings guests have already paid for. '
                            : ''}
                You’re live and guests can book you. We hold your share of each booking until your payouts are set up,
                then send it to your bank — anything already due goes out on our next daily payout.
            </p>
            <div className="mt-4">
                <PayoutSetupButton providerId={providerId} label={connected ? 'Finish setting up payouts' : 'Set up payouts'} />
            </div>
        </div>
    );
}

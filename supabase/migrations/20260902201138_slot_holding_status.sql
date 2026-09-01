-- A slot booking needs a status the request shapes don't: 'holding'.
--
-- It is the 15-minute seat reservation across Checkout — the seat is taken, but
-- no money has moved and no PaymentIntent exists yet (unlike 'authorised', which
-- means a card is held). The webhook turns it into 'confirmed' on payment; the
-- sweep turns an unpaid one into 'expired' and releases the seat. Keeping it a
-- distinct status is what stops the request-shape sweep trying to cancel a
-- PaymentIntent that a slot hold never had.

alter table public.service_orders drop constraint if exists service_orders_status_check;
alter table public.service_orders add constraint service_orders_status_check
    check (status = any (array[
        'holding', 'authorised', 'confirmed', 'declined', 'expired', 'cancelled', 'refunded'
    ]));

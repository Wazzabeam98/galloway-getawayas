-- Record the linked-travel-arrangement notice a guest was shown at a stay-linked
-- experience checkout, against the order: which wording version, and when.
--
-- Both columns are null for a standalone order (no stay), which never shows the
-- notice. Written by the order-creation paths (lib/requestOrder.ts and the slot
-- book route) whenever the order carries a booking_id. The wording itself lives
-- in lib/linkedTravelNotice; only the version identifier is stored here.

ALTER TABLE service_orders
    ADD COLUMN IF NOT EXISTS lta_notice_version text,
    ADD COLUMN IF NOT EXISTS lta_notice_shown_at timestamptz;

COMMENT ON COLUMN service_orders.lta_notice_version IS
    'Version of the linked-travel-arrangement notice shown at a stay-linked experience checkout (lib/linkedTravelNotice.LTA_NOTICE_VERSION). Null for standalone orders, which never show it.';
COMMENT ON COLUMN service_orders.lta_notice_shown_at IS
    'When the guest was shown the linked-travel-arrangement notice at checkout. Null for standalone orders.';

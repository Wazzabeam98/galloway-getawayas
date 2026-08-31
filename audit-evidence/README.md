# Audit evidence — night of 28→29 Aug 2026

Raw output captured while closing the four write-side holes and running the
wider audit. Every file here is probe OUTPUT, not source. Nothing in this
folder runs.

- 01-before-all-four.txt         write-side-rls.mjs against prod, holes open (5 WRITABLE)
- 03-after-profiles.txt          after migration 20260829010000 (is_admin, payout closed)
- 04-after-bookings.txt          after 20260829011000 (paid-booking insert closed)
- 05-after-reviews.txt           after 20260829012000 (fake review closed) — 0 WRITABLE
- 06-allowed-paths-prod.txt      write-side-allowed.mjs — 11 legit writes still work
- 07-data-privacy-really-prod.txt data-privacy-rls.mjs, now actually hitting prod
- 08-storage-probe.txt           arbitrary upload to the public bucket
- 09-self-elevation-probe.txt    self-publish (works), self-approve/commission (refused)
- 10..14 forged-cookie proof     getSession signature-verification investigation

# Overnight build — progress log

Branch: `overnight/guest-experiences` (off `trips-card-polish`, which contains PR #98 + trips teaser).
Rules honoured: work on branches, deploy previews, no merge to master, no prod deploy, no prod migration.

## Order of work (from the brief)
1. [ ] /business two beautiful cards (PR #77 fork exists — polish, don't rebuild)
2. [ ] Guest category picker (mirror TradeTiles), soft suggestion, "Other" last
3. [ ] Adaptive sign-up: infer shape, show only fields that apply (§10)
4. [ ] Schedule editor (weekly hours, slot length, capacity, block-a-date)
5. [ ] "Your business" step desktop layout (wider modal, 3 groups, name by business name)
6. [ ] display-name recommendation (profiles.show_full_name) — RECOMMEND, don't build
7. [ ] Wizard: screenshot every step @ desktop/tablet/375, walk end-to-end incl. email
8. [ ] Marketplace visuals: trust signals, post-booking page, slot receipt email, mobile Book bar, theme to slate
9. [ ] Chef "View request" email dead link
10. [ ] Prove cottage-cancel → order cancel cascade
11. [ ] Baker-vs-chef semantics (drop "guests", frame date per shape, spec not party size)
12. [ ] PR #98 fix A: balance_due_date day-key treatment (+ prove failing)
13. [ ] PR #98 fix B: order page address select (street_address/location/postcode, handle error, drop `as any`)
14. [ ] Address required on a listing (street + postcode) — check prod listings first, read-only
15. [ ] Trips card check-in/checkout rail rebuild (vertical rail, before/after @ 3 widths)
16. [ ] Deploy preview, seed guest/host/provider, morning report

## Log
- Set up branch, read CLAUDE.md, marketplace note (§10 confirms slot engine/diary/shapes built; only sign-up UI missing), dayKey/cancellation patterns, both PR#98 bug sites confirmed.
- DONE + committed: (1) PR#98 balance_due_date day-key fix + test; (2) PR#98 order-page address fix; (3) cottage-cancel→slot seat-release cascade fix + test (found a real bug). All unit-tested; only red is the scenario-coverage fingerprint guard (expected — run scenarios before push).
- DONE: /business two-card polish.
- DONE: guest wizard — category picker (9 D&G categories, "Something else" last), adaptive shape question, schedule editor (weekly hours/private-shared/capacity/length/days-off), made-to-order lead time, wider 2-col desktop business step, Your name beside business name, item row labels + bigger photo well, food question conditional on food category. Writes wired (shape, custom_label seed, lead_time, slot config, slot_availability/blocks) through apply→finish and signed-in save. openingStep test added.
- DONE: marketplace — slate theme, trust signal (headshot + bookings count / "New here"), mobile fixed Book bar.
- DONE: post-booking — order-page confirmation (booked banner + what-happens-next + add-to-calendar .ics) for slots; /experiences/requested page for held requests. Success URLs repointed.
- DONE: chef "View the request" email deep-links to the order (#order-<id> + :target highlight on dashboard row); slot receipt link → order page. NOTE: slot guest receipt email already existed — OUTSTANDING note was stale.
- DONE: baker-vs-chef semantics — date framed by shape (appointment / "Ready for" / date+time), "N guests" dropped for non-attending shapes; made-to-order note invites size/message/collection-or-delivery.
- Seeded marketplace demo (Morag + 8 providers across shapes) on TEST project for viewing.

## Still to do
- Trips card check-in/checkout rail rebuild (vertical rail).
- Address required on a listing (street + postcode) + read-only prod check.
- Verify admin review has the shape/category control (§10 says built).
- Wizard screenshots @ desktop/tablet/375; walk fresh-applicant incl. email round trip.
- Run scenarios (money-path guard) → commit SCENARIO-RESULTS.json.
- display-name recommendation (write-up).
- Push preview, seed dated demo data, morning report (URL + 3 logins + URL list).

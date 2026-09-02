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

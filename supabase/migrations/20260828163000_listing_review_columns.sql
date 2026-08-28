-- What happened when somebody looked at a listing.
--
-- PRE-FLIGHT: none needed. Three nullable columns, no existing row touched.
-- Safe to run twice; safe to run on both projects.
--
-- WHY THESE NAMES
--
-- They are the ones `service_providers` already uses — `review_note`,
-- `approved_at`, `declined_at` — because listings are getting the same
-- approval queue and the same decision route shape. Two tables answering the
-- same question with different column names is how the second screen ends up
-- written twice.
--
-- WHAT A DECLINE DOES, AND WHY THERE IS NO 'declined' STATUS
--
-- A declined listing goes back to `draft`, not to a status of its own.
--
-- That is deliberate. The point of declining is that the host fixes it and
-- sends it again, and `draft` is already the state that means "yours, not
-- finished, reopens in the wizard at /addhome?draft=<id>". Adding a fourth
-- status would need every screen taught a state that behaves identically to
-- one they already handle, and would give a host a listing they could look at
-- but not edit.
--
-- `review_note` is what makes the difference visible: a draft with a note was
-- sent back and says why; a draft without one was simply never finished. The
-- host's dashboard reads exactly that.
--
-- `declined_at` is kept even though the status returns to draft, because "when
-- was this last turned down" is a real question and the status cannot answer
-- it once the row is a draft again.

alter table public.listings
    add column if not exists review_note  text,
    add column if not exists approved_at  timestamptz,
    add column if not exists declined_at  timestamptz;

comment on column public.listings.review_note is
    'Why a listing was sent back, written by an owner and shown to the host. '
    'Set on decline, cleared on approve. A draft carrying one was declined; a '
    'draft without one was never finished.';

comment on column public.listings.approved_at is
    'When an owner last approved this listing. Null means never approved — '
    'including every listing that went live before approval existed.';

comment on column public.listings.declined_at is
    'When an owner last sent this listing back. Survives the status returning '
    'to draft, which is the only record that it happened.';

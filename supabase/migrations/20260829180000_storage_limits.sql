-- The public bucket will take an image, and only an image, and only so big.
--
-- WHAT WAS THERE. The `listings` bucket had no file_size_limit and no
-- allowed_mime_types, and its INSERT policy is `bucket_id = 'listings'` — no
-- size, no type, no scoping. Proven on production during the overnight audit:
-- an ordinary free account uploaded an arbitrary file to a publicly readable
-- bucket.
--
-- What already held, and still does: there is no UPDATE and no DELETE policy,
-- so nobody can overwrite or remove a host's photos. That is the half that
-- would have been theft. What was left is cost and abuse — your storage bill,
-- and arbitrary content hosted on your infrastructure.
--
-- THE NUMBERS, FROM WHAT IS ACTUALLY THERE.
--
-- Every object ever uploaded to production is image/jpeg (38) or image/png (2),
-- and the largest is 3.2MB. lib/compressImage passes jpeg and png under 900KB
-- through untouched and re-encodes anything else to image/jpeg, so the app
-- itself never produces anything outside this list.
--
-- 10MB leaves headroom of three times the largest real file. webp and avif are
-- allowed because a browser may hand one over directly; heic and heif because
-- an iPhone can, and a host uploading a photo straight from their phone is the
-- common case, not the exotic one.
--
-- NOT IN HERE: owner-scoped path prefixes. Listing photos are written flat at
-- the bucket root as `<timestamp>_<random>` with no owner in the name — only
-- avatars are prefixed. Scoping the path would mean changing where uploads go
-- AND either migrating the existing objects or grandfathering them, and
-- getting it wrong breaks photo upload, which is the thing hosts do most. The
-- abuse this finding was about is closed by the two settings below; the path
-- work is recorded in OUTSTANDING.md as its own job.
--
-- Pre-flight:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--
-- Safe to run twice.

update storage.buckets
   set file_size_limit = 10485760,   -- 10 MiB
       allowed_mime_types = array[
           'image/jpeg',
           'image/png',
           'image/webp',
           'image/avif',
           'image/heic',
           'image/heif'
       ]
 where id in ('listings', 'listings-removed');

-- Read back — expect two rows, both limited:
--   select id, file_size_limit, allowed_mime_types from storage.buckets;

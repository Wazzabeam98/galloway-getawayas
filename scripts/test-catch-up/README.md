# Bringing the test database into line

Two SQL files, run by hand in the Supabase SQL editor against **test**. They
are not migrations and must never be copied into `supabase/migrations`.

The service migrations were corrected in place rather than patched, because
none of them have ever run on production — so production gets the right shape
first time. Test already ran the old versions, and Supabase records migrations
as applied by filename, so the edited files will not re-run there.

```
1-add-and-backfill.sql   run BEFORE deploying    adds only, site keeps working
        ...deploy...
2-drop-old-columns.sql   run AFTER the deploy    removes the old columns
```

Both refuse to run rather than half-finish, and both are safe to run twice.

Do not run step two until the deploy is live and the sign-up, the admin queue
and the trade picker have all been loaded once. Between the two steps the
database carries both shapes at the same time, which is the point — that is
the window the deploy lands in.

# Undoing the business/listing split, on test

One file, run by hand in the Supabase SQL editor against **test**. Not a
migration, never copied into `supabase/migrations`, and it runs once.

```
undo-the-split.sql
```

## Why it exists

`service_providers` was briefly two tables — a business and its trade listings
— so that somebody holding several trades typed their name once. That was
wrong: a cleaning round and a window round are two businesses under two names,
and each trade should be set up from scratch. The migrations are back to their
original shape, where the listing carries its own name and `unique(owner_id,
trade)` gives one business per trade per person.

Test had run step one of the old catch-up. **Step two never ran**, which is the
only reason this is cheap — step two was the half that dropped `owner_id`,
`business_name` and `contact_email`, and they are all still here and still
populated. If you find this file having already run step two, stop: the data
those columns held has to come back from `service_businesses` before anything
else, and this script assumes it never left.

It also takes the trial out. There is no free trial; it is 10% per job from the
first job.

Safe to run twice, and it stops rather than half-finishing.

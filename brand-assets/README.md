# Galloway Getaways — brand assets

Rebuilt from the site's logo code (`components/base/Logo.tsx`). The flying-goose
mark is the same vector used in the site header.

## The wordmark is OUTLINED — no font needed

The name ("Galloway GETAWAYS") in the lockup files has been **converted to vector
paths**. There is no live text and no font dependency, so a printer cannot
substitute a different font — what you see is what prints.

**Font it was set in:** **Inter** — *Inter ExtraBold* for "Galloway", *Inter
SemiBold* for "GETAWAYS" (SIL Open Font License, free to embed and redistribute).

Note: the website renders the name in `system-ui`, which is **not one font** —
it's San Francisco on macOS, Segoe UI on Windows, Roboto on Android. That means
the live logo already looks slightly different per device. These files lock it
to Inter so it is identical everywhere and safe to hand to a printer. If you ever
want the exact San Francisco shapes instead, that's an Apple-licensed font and a
separate decision.

## Files

| File | Use |
|---|---|
| `galloway-lockup-on-white.*`   | Primary logo (mark + name) for light backgrounds. White background baked in. |
| `galloway-lockup-on-dark.*`    | Reversed logo for dark backgrounds. Transparent — drops onto any dark colour. |
| `galloway-goose-mark.*`        | The mark on its own, emerald, transparent. |
| `galloway-goose-mark-reversed.*` | The mark on its own, light green, for dark backgrounds. Transparent. |

Each comes as **`.svg`** (vector — scales to any size with no pixelation; the
right choice for a banner) and **`.png`** (3000 px wide, transparent where noted;
for tools that don't take SVG).

## Colours

- Emerald (primary): `#047857`  (Tailwind emerald-700 — the mark and "GETAWAYS")
- Light emerald (on dark): `#34d399`  (emerald-400)
- Ink ("Galloway" on light): `#1c1917`  (stone-900)
- Reversed ink ("Galloway" on dark): `#ffffff`

The mark itself contains no text, so it has never had a font dependency at any size.

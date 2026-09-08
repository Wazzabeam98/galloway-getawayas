# Experience photo placeholders — SWAP THESE

These two files are **placeholders**, shown as the overlapping/tilted graphic on the
guest sign-up Photos screen (`g_photos`) when a provider has added no photos yet.

- `sauna.svg` — stands in for a wood-fired barrel sauna, outdoors.
- `dining.svg` — stands in for a table of food / cooking.

They are hand-drawn SVGs (the image-generation tool wasn't available when they were
made), deliberately captioned "PLACEHOLDER" so they can't be mistaken for final art.

## To replace with real photographs

1. Drop real photos of local businesses into this folder.
2. Update the two `src` paths in the composition — search `experience-placeholders`
   in `components/services/ProviderSignUp.tsx` (constant `PHOTO_PLACEHOLDERS`).
   Either keep these filenames (overwrite `sauna.svg` / `dining.svg`) or point the
   constant at the new filenames/extensions (e.g. `sauna.jpg`).

Portrait framing (~4:5) matches the layout; use warm, natural light and a Dumfries &
Galloway setting so the two read as one consistent set.

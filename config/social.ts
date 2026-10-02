// The social accounts, in one place.
//
// Changed here and the footer and the organisation structured data both
// follow. The alternative — the same URL pasted into each place that needs it
// — is how you end up with the footer pointing at one account and Google told
// about another.
//
// THESE ARE THE CLEAN CANONICAL URLS, ON PURPOSE. What was handed over were
// share links carrying tracking parameters:
//
//   https://www.facebook.com/share/1GqrcGLZvz/?mibextid=wwXIfr
//   https://www.instagram.com/galloway_getaways?stkn=dGM2bXE0dHd0MDk2
//
// A share link identifies whoever generated it, can expire, and is the wrong
// thing to hand Google as the business's official profile in `sameAs`. Each
// was opened in Chrome and its redirect followed; the URLs below are what the
// platforms themselves declare in `<link rel="canonical">` on the resolved
// page:
//
//   facebook.com/share/1GqrcGLZvz/  ->  facebook.com/p/Galloway-Getaways-61594246473233/
//   instagram.com/galloway_getaways ->  instagram.com/galloway_getaways/
//
// Blank one out to remove it. The footer then renders nothing at all for it
// rather than a dead icon, and it drops out of `sameAs` — so a half-finished
// account never becomes a link to nowhere.
export const SOCIAL = {
    instagram: 'https://www.instagram.com/galloway_getaways/',
    facebook: 'https://www.facebook.com/p/Galloway-Getaways-61594246473233/',
};

// Every account that actually has a URL, for schema.org `sameAs`.
//
// Returns an empty array when there are none, and the caller leaves `sameAs`
// off the schema entirely rather than emitting an empty one — an empty array
// is a claim about the business ("it has no other profiles") rather than the
// absence of a claim.
export function socialUrls(): string[] {
    return [SOCIAL.instagram, SOCIAL.facebook].filter(
        (url) => typeof url === 'string' && url.trim().length > 0
    );
}

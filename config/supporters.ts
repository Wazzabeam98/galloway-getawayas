// The organisations and schemes we proudly support, in one place.
//
// The footer renders a small "Proud supporters of" strip from this list, and
// the /local-commitment page shows the same badges. Add an entry here and both
// follow; an empty list renders nothing at all in either place, rather than an
// empty heading or a badge pointing nowhere — the same rule the social links
// follow.
//
// A badge is a third party's own mark. Only ever point `src` at the artwork
// they supplied (in /public/supporters), use the wording they ask for, and
// link to their own site. Never redraw or approximate someone else's logo.

export interface Supporter {
    // A short internal name, also the React key. Not shown to anyone.
    name: string;
    // The image alt text. Describes what the badge says, for image search and
    // for a screen reader when the badge is shown outside a link.
    alt: string;
    // The organisation's own website. Opened in a new tab.
    href: string;
    // The badge artwork in /public/supporters.
    src: string;
    // The badge's intrinsic size, so the browser reserves the right box before
    // the image loads (no layout shift). The strip then scales it to a set
    // height; the width rides along from the aspect ratio.
    width: number;
    height: number;
}

export const SUPPORTERS: Supporter[] = [
    {
        name: 'GSA UNESCO Biosphere',
        alt: 'Proud supporter of the Galloway and Southern Ayrshire UNESCO Biosphere',
        href: 'https://www.gsabiosphere.org.uk',
        // The provider's own "RASTER for in-house use" (on-screen) artwork, the
        // full-colour badge on a transparent background, resized from their
        // 1104px master to 256px for the web. Their EPS is CMYK, for print only.
        src: '/supporters/gsa-biosphere-proud-supporter.png',
        width: 256,
        height: 256,
    },
];

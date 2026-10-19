import type { MetadataRoute } from 'next';

// The web app manifest, served at /manifest.webmanifest. It is what lets a
// phone add the site to its Home Screen as an app: the name under the icon,
// the icon itself (drawn from the goose by app/icons/[file]), and that it
// opens full-screen with no browser bars around it.
//
// The emerald theme colour lives here and ONLY here — not as a theme-color
// meta tag — so it tints the installed app's status bar without changing how
// the site looks in an ordinary browser tab.
export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: 'Galloway Getaways',
        short_name: 'Galloway Getaways',
        description: 'Holiday cottages across Dumfries & Galloway, booked direct.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#047857',
        background_color: '#ffffff',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}

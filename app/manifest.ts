import type { MetadataRoute } from 'next';

// The web app manifest, served at /manifest.webmanifest. It is what lets a
// phone add the site to its Home Screen as an app: the name under the icon,
// the icon itself (drawn from the goose by app/icons/[file]), and that it
// opens full-screen with no browser bars around it.
//
// The theme colour. White, to match the white header — so the installed app's
// title bar on a Mac and the status bar on an iPhone blend into the page the
// way Airbnb's do, rather than showing a band of colour above it. It is set in
// two places on purpose: here, which tints the installed/standalone app, and a
// theme-color meta tag in app/layout.tsx, which tints the browser chrome on a
// phone. Both say white; keep them in step if either changes. (Was emerald
// #047857, kept only in the manifest to avoid tinting the browser tab — but a
// white header wants the chrome white too, so the meta tag is now welcome.)
export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: 'Galloway Getaways',
        short_name: 'Galloway Getaways',
        description: 'Holiday cottages across Dumfries & Galloway, booked direct.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}

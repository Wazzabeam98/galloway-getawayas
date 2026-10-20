'use client';

// The installable-app plumbing, mounted once in the root layout.
//
// 1. Registers the service worker (public/sw.js) — production only, so a dev
//    server's ever-changing chunks are never cached.
// 2. Holds back Chrome's own "Install app" banner, so the site looks and
//    behaves in a browser exactly as it did. The event is kept for the
//    Add to Home Screen hint (InstallHint), which offers it at the right time.
// 3. On a device that already said yes to notifications, makes sure the
//    server has this device against whoever is signed in now — once a visit.
// 4. In the installed app: the first-open notifications card (FirstRunPush).
//
// The Add to Home Screen hint itself is InstallHint, placed in the page after
// its own content (app/layout.tsx), never floating over it.

import { useEffect } from 'react';
import { syncPush } from '@/lib/pushClient';
import FirstRunPush from './FirstRunPush';

export const INSTALL_EVENT = 'gg:install-available';

export default function PwaSetup() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* not fatal */ });

        try {
            if (sessionStorage.getItem('gg-push-synced') !== '1') {
                sessionStorage.setItem('gg-push-synced', '1');
                syncPush();
            }
        } catch { /* private mode */ }
    }, []);

    useEffect(() => {
        const onPrompt = (e: Event) => {
            e.preventDefault();
            (window as any).__ggInstallEvent = e;
            window.dispatchEvent(new Event(INSTALL_EVENT));
        };
        window.addEventListener('beforeinstallprompt', onPrompt);
        return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }, []);

    return <FirstRunPush />;
}

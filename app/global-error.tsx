'use client';

import { useEffect } from 'react';

// The very last resort. This fires when the layout itself fails, so it can't
// rely on any of the site's own components or styling being available — hence
// the inline styles and its own html and body tags.
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[global]', error);
    }, [error]);

    return (
        <html lang="en">
            <body
                style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    margin: 0,
                    padding: '24px',
                    color: '#0f172a',
                }}
            >
                <div style={{ maxWidth: '420px', textAlign: 'center' }}>
                    <h1 style={{ fontSize: '24px', marginBottom: '12px' }}>
                        Galloway Getaways is having a moment
                    </h1>
                    <p style={{ color: '#475569', marginBottom: '24px', lineHeight: 1.5 }}>
                        Something has gone wrong at our end. Please try again in a minute. If you
                        were paying for a stay, nothing will have been taken twice.
                    </p>
                    <button
                        type="button"
                        onClick={reset}
                        style={{
                            background: '#047857',
                            color: '#fff',
                            border: 0,
                            padding: '12px 20px',
                            borderRadius: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Try again
                    </button>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '32px' }}>
                        hello@gallowaygetaways.co.uk
                    </p>
                </div>
            </body>
        </html>
    );
}

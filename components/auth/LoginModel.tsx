'use client';

import React from 'react';
import { openAuthPanel } from './AuthPanel';

// The "Log in or sign up" button. It no longer holds a form of its own: every
// copy on the site opens the one panel mounted in the root layout
// (components/auth/AuthPanel), so log in and sign up are a single door, as on
// Airbnb, and there is no password box anywhere for a new account.
//
// `next` is where to land once signed in (a trip invite, say). Without it the
// page reloads in place — and a listing keeps its dates and guests, because
// they are in its URL.
//
// Forwards its ref and onClick to the button so the account menu can wrap it
// in PopoverClose and shut the menu as the panel opens.
type Props = {
    next?: string;
    variant?: 'menu' | 'button';
    label?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'>;

const LoginModel = React.forwardRef<HTMLButtonElement, Props>(function LoginModel(
    { next, variant = 'menu', label, onClick, className: _ignored, ...rest },
    ref
) {
    const open = (e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        // The account menu's Log in is the general way in, so it lands a host
        // or provider on their working side (app/auth/land). The button variant
        // is a task on the page — book, review, accept — and stays put.
        openAuthPanel(next, { land: variant === 'menu' });
    };

    // variant="button" is a full-width primary button, for where signing in is
    // the page's main action (the booking box, a review link). The default is
    // the account-menu row.
    if (variant === 'button') {
        return (
            <button
                {...rest}
                ref={ref}
                type="button"
                onClick={open}
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition"
            >
                {label || 'Log in or sign up'}
            </button>
        );
    }

    // A button rather than a clickable <li>, so a keyboard can reach it.
    return (
        <li className="list-none">
            <button
                {...rest}
                ref={ref}
                type="button"
                onClick={open}
                className="w-full text-left font-semibold hover:bg-slate-200 rounded-md p-2 cursor-pointer"
            >
                {label || 'Log in or sign up'}
            </button>
        </li>
    );
});

export default LoginModel;

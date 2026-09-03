"use client"

import React, { useState } from 'react';
import { useForm } from "react-hook-form";
import { yupResolver } from '@hookform/resolvers/yup';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { X, MailCheck } from 'lucide-react'
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { registerType, registerSchema } from '@/validation/authSchema';
import { toast } from 'react-toastify';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { supabaseEmailFlow } from '@/lib/supabaseEmailFlow';
import { useRouter } from 'next/navigation';
import SocialSignUp from './SocialSignUp';


const SignupModel = () => {
    const [open, setOpen] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);

    // After a successful signup we swap the form out for a "check your email"
    // panel instead of closing the dialog — the account isn't usable until the
    // link is clicked, so closing silently just leaves people confused.
    const [sentTo, setSentTo] = useState<string>('');
    const [resending, setResending] = useState<boolean>(false);

    // Kept in the dialog rather than only in a toast. A toast is at the top of
    // the screen and gone in five seconds, while the person is looking at a
    // box in the middle of the screen wondering why nothing happened.
    const [failure, setFailure] = useState<string>('');

    const supabase = createClientComponentClient();
    const router = useRouter();

    const { register, handleSubmit, reset, formState: { errors } } = useForm<registerType>({
        resolver: yupResolver(registerSchema)
    });

    // Supabase's own wording, turned into something a guest can act on.
    const explain = (err: any): string => {
        const message: string = (err && err.message) || '';
        const status: number = (err && err.status) || 0;

        // The one that bit us: Supabase's built-in email service allows only a
        // handful of messages an hour, and a send it refuses fails the whole
        // signUp — no account is created. It clears on its own, so say so
        // rather than leaving someone thinking the site is broken.
        if (status === 429 || /rate limit/i.test(message)) {
            return 'We could not send your confirmation email just now — too many have gone out from the site in the last hour. Nothing is wrong with your details. Please try again a little later.';
        }
        if (/already registered|already been registered/i.test(message)) {
            return 'There is already an account with that email address. Try logging in instead, or use the forgotten password link.';
        }
        if (/password/i.test(message)) {
            return message;
        }
        if (!message) {
            return 'Something went wrong reaching the server, so your account was not created. Please check your connection and try again.';
        }
        return message;
    };

    const closeAndReset = () => {
        setOpen(false);
        setSentTo('');
        setResending(false);
        setFailure('');
        reset();
    };

    const onSubmit = async (payload: registerType) => {
        setLoading(true);
        setFailure('');

        // signUp returns Supabase's own auth errors but THROWS anything else —
        // a dropped connection, a 5xx, a CORS refusal. Without this catch the
        // throw escaped, setLoading(false) never ran, and the button sat on
        // "Processing.." for ever having told the guest nothing whatsoever.
        try {
            const { data, error } = await supabaseEmailFlow().auth.signUp({
                email: payload.email,
                password: payload.password,
                options: {
                    data: {
                        name: payload.name,
                    },
                    // Without this the confirmation link goes to the Site URL —
                    // the home page — where nothing exists to turn it into a
                    // session, so a guest who confirmed their address arrived
                    // signed out and assumed it had not worked.
                    //
                    // ?next= returns them to wherever they signed up — the same
                    // instinct as the Google button. It matters most for a friend
                    // who signs up FROM a trip invite: without it the confirmation
                    // link drops them on the home page with no idea what just
                    // happened; with it they land back on the invite to accept.
                    // safeNext in the callback keeps it to our own paths.
                    emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
                },
            });

            if (error) {
                setLoading(false);
                const readable = explain(error);
                setFailure(readable);
                toast.error(readable, { theme: 'colored' });
                return;
            }

            // If email confirmation is switched on in Supabase, signUp returns a
            // user but NO session. If it's switched off, we get a session straight
            // away and can carry on as a normal login.
            if (data.session) {
                // Only reachable with email confirmation switched OFF. The
                // email-flow client keeps no session of its own, so hand it to
                // the auth-helpers client, which owns the cookies the rest of
                // the site reads. Without this the signup would look like it
                // worked and leave them signed out.
                await supabase.auth.setSession(data.session);

                // UPDATE, NOT UPSERT. add_profile_for_new_user has already
                // created this row from the auth record — id, email, full_name
                // and is_host — so there is nothing to insert. The upsert also
                // needed SELECT on email, which 20260828234003 revoked, so it
                // had been failing silently since that migration landed.
                //
                // Only the name is written: email belongs to the trigger, and
                // is_host already defaults to false there.
                const { error: profileError } = await supabase
                    .from('profiles')
                    .update({ full_name: payload.name })
                    .eq('id', data.session.user.id);

                if (profileError) {
                    console.error('Profile insertion error:', profileError.message);
                }

                setLoading(false);
                closeAndReset();
                router.refresh();
                toast.success('Welcome to Galloway Getaways', { theme: 'colored' });
                return;
            }

            // No session — the confirmation email is on its way.
            setLoading(false);
            setSentTo(payload.email);
        } catch (err: any) {
            setLoading(false);
            const readable = explain(err);
            setFailure(readable);
            toast.error(readable, { theme: 'colored' });
        }
    };

    const resendEmail = async () => {
        if (!sentTo) return;
        setResending(true);

        const { error } = await supabaseEmailFlow().auth.resend({
            type: 'signup',
            email: sentTo,
            // The resend needs it too. Without it the second email points
            // somewhere different from the first, which is a fine way to spend
            // an afternoon wondering why only one of them works.
            options: {
                emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
            },
        });

        setResending(false);

        if (error) {
            const readable = explain(error);
            setFailure(readable);
            toast.error(readable, { theme: 'colored' });
            return;
        }

        setFailure('');
        toast.success('Confirmation email sent again.', { theme: 'colored' });
    };

    return (
        <AlertDialog open={open}>
            {/* A button, for the same reason as Log In: a clickable <li> is
                not in the tab order, and these two were the only items in the
                account menu that were not links — so a keyboard could reach
                neither, and nobody using one could get an account. asChild
                needs a single focusable child, so the button is the trigger
                and the <li> sits outside it. */}
            <li className='list-none'>
                <AlertDialogTrigger asChild>
                    <button
                        type='button'
                        onClick={() => setOpen(true)}
                        className='w-full text-left hover:bg-slate-200 rounded-md p-2 cursor-pointer'
                    >
                        Sign Up
                    </button>
                </AlertDialogTrigger>
            </li>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <div className='flex justify-between items-center'>
                            <span>{sentTo ? 'Confirm your email' : 'Sign Up'}</span>
                            <X className='cursor-pointer' onClick={closeAndReset} />
                        </div>
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        {sentTo ? (
                            <div className='py-2'>
                                <div className='flex justify-center mb-4'>
                                    <div className='w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center'>
                                        <MailCheck className='w-7 h-7 text-emerald-700' />
                                    </div>
                                </div>

                                <h1 className='text-lg font-bold text-center text-slate-900'>
                                    Check your inbox
                                </h1>

                                <p className='text-sm text-slate-600 text-center mt-2'>
                                    We&apos;ve sent a confirmation link to{' '}
                                    <span className='font-semibold text-slate-900'>{sentTo}</span>.
                                    Click the link in that email to activate your account and finish signing in.
                                </p>

                                {failure && (
                                    <div className='mt-4 rounded-lg border border-red-200 bg-red-50 p-3'>
                                        <p className='text-sm text-red-800'>{failure}</p>
                                    </div>
                                )}

                                <div className='mt-4 rounded-lg bg-slate-50 border p-3'>
                                    <p className='text-xs text-slate-500'>
                                        Can&apos;t find it? Give it a couple of minutes, then check your junk or spam
                                        folder — confirmation emails often land there.
                                    </p>
                                </div>

                                <div className='mt-5 flex flex-col space-y-2'>
                                    <Button
                                        type='button'
                                        onClick={resendEmail}
                                        disabled={resending}
                                        className='w-full'
                                    >
                                        {resending ? 'Sending...' : 'Resend confirmation email'}
                                    </Button>
                                    <button
                                        type='button'
                                        onClick={closeAndReset}
                                        className='w-full text-sm text-slate-500 hover:text-slate-800 py-2'
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        ) : (
                        <div>
                            <form onSubmit={handleSubmit(onSubmit)}>
                                <h1 className='text-lg font-bold'>
                                    Welcome to Galloway Getaways
                                </h1>

                                {/* Stays on screen until something changes it,
                                    unlike the toast, which is at the top of the
                                    page and gone in five seconds. */}
                                {failure && (
                                    <div className='mt-4 rounded-lg border border-red-200 bg-red-50 p-3'>
                                        <p className='text-sm text-red-800'>{failure}</p>
                                    </div>
                                )}
                                <div className='mt-5'>
                                    <Label htmlFor='name'>Name</Label>
                                    <Input id='name' placeholder='Enter your Name' {...register('name')} />
                                    <span className='text-red-400'>{errors.name?.message}</span>
                                </div>
                                <div className='mt-5'>
                                    <Label htmlFor='email'>Email</Label>
                                    <Input id='email' type='email' placeholder='Enter your e-mail' {...register('email')} />
                                    <span className='text-red-400'>{errors.email?.message}</span>
                                </div>
                                <div className='mt-5'>
                                    <Label htmlFor='password'>Password</Label>
                                    <Input id='password' type='password' placeholder='Enter strong password' {...register('password')} />
                                    <span className='text-red-400'>{errors.password?.message}</span>
                                </div>
                                <div className='mt-5'>
                                    <Label htmlFor='cpassword'>Confirm Password</Label>
                                    <Input id='cpassword' type='password' placeholder='Repeat password' {...register('passwordConfirm')} />
                                    <span className='text-red-400'>{errors.passwordConfirm?.message}</span>
                                </div>
                                <div className='mt-5'>
                                    <Button className='w-full bg-brand' disabled={loading}>
                                        {loading ? 'Processing..' : 'Continue'}
                                    </Button>
                                </div>
                            </form>
                            <SocialSignUp />
                        </div>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default SignupModel;

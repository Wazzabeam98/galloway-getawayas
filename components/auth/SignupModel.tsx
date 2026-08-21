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

    const supabase = createClientComponentClient();
    const router = useRouter();

    const { register, handleSubmit, reset, formState: { errors } } = useForm<registerType>({
        resolver: yupResolver(registerSchema)
    });

    const closeAndReset = () => {
        setOpen(false);
        setSentTo('');
        setResending(false);
        reset();
    };

    const onSubmit = async (payload: registerType) => {
        setLoading(true);

        const { data, error } = await supabase.auth.signUp({
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
                emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (error) {
            setLoading(false);
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        // If email confirmation is switched on in Supabase, signUp returns a
        // user but NO session. If it's switched off, we get a session straight
        // away and can carry on as a normal login.
        if (data.session) {
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert(
                    {
                        id: data.session.user.id,
                        email: payload.email,
                        full_name: payload.name,
                        is_host: false,
                    },
                    { onConflict: 'id' }
                );

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
    };

    const resendEmail = async () => {
        if (!sentTo) return;
        setResending(true);

        const { error } = await supabase.auth.resend({
            type: 'signup',
            email: sentTo,
        });

        setResending(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success('Confirmation email sent again.', { theme: 'colored' });
    };

    return (
        <AlertDialog open={open}>
            <AlertDialogTrigger asChild>
                <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer' onClick={() => setOpen(true)}>
                    Sign Up
                </li>
            </AlertDialogTrigger>
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
                                <div>
                                    <h1 className='text-center font-bold text-xl my-2'>-- or --</h1>
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

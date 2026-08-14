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
import { X } from 'lucide-react'
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
    const supabase = createClientComponentClient();
    const router = useRouter();
    
    const { register, handleSubmit, formState: { errors } } = useForm<registerType>({
        resolver: yupResolver(registerSchema)
    });

    const onSubmit = async (payload: registerType) => {
        setLoading(true);

        // 1. Sign up user with Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email: payload.email,
            password: payload.password,
            options: {
                data: {
                    name: payload.name,
                },
            },
        });

        if (error) {
            setLoading(false);
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        // 2. Sign in first, so the session exists before we try to write to
        // profiles — otherwise the insert below silently gets blocked.
        if (data.user) {
            await supabase.auth.signInWithPassword({
                email: payload.email,
                password: payload.password
            });

            // 3. Create (or update) the profile record, now that we're
            // properly authenticated as this user.
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert(
                    {
                        id: data.user.id,
                        email: payload.email,
                        full_name: payload.name,
                        is_host: false, // Defaults to regular user/guest
                    },
                    { onConflict: 'id' }
                );

            if (profileError) {
                console.error("Profile insertion error:", profileError.message);
            }

            setOpen(false);
            router.refresh();
            toast.success('Account created successfully', { theme: 'colored' });
        }

        setLoading(false);
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
                            <span>Sign Up</span>
                            <X className='cursor-pointer' onClick={() => setOpen(false)} />
                        </div>
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
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
                    </AlertDialogDescription>
                </AlertDialogHeader>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default SignupModel;

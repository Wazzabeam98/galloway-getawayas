'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import Logo from '@/components/base/Logo';
import { HomeIcon, ChevronRightIcon } from 'lucide-react';
import LoginModel from '@/components/auth/LoginModel';

export default function AddHome() {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [userName, setUserName] = useState('');
    const [showListingForm, setShowListingForm] = useState(false);
    
    // Listing form state
    const [title, setTitle] = useState('');
    const [price, setPrice] = useState('');
    const [country, setCountry] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [description, setDescription] = useState('');

    const router = useRouter();
    const supabase = createClientComponentClient();

    useEffect(() => {
        const checkUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (session?.user) {
                setUserName(session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Host');
            }
            setLoading(false);
        };

        checkUser();
    }, [supabase]);

    // Loading screen with Galloway Getaways branding
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[80vh] space-y-4">
                <Logo />
                <p className="text-lg font-medium text-slate-600 animate-pulse">
                    Please wait while we load Galloway Getaways for you...
                </p>
            </div>
        );
    }

    // If not logged in, prompt login
    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to become a host</h1>
                <p className="text-slate-600 max-w-md">
                    You need to be logged into your Galloway Getaways account to create and manage listings.
                </p>
                <div className="flex space-x-4">
                    <LoginModel />
                </div>
            </div>
        );
    }

    // If user clicked "Create a new listing", show the listing form
    if (showListingForm) {
        return (
            <div className="max-w-6xl mx-auto px-6 py-10">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-extrabold text-rose-500">
                        Galloway Getaways it <span className="text-slate-900 font-normal text-xl block">You could earn per night</span>
                    </h1>
                    <button 
                        onClick={() => setShowListingForm(false)}
                        className="text-sm font-semibold underline text-slate-600 hover:text-black"
                    >
                        Back to dashboard
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {/* Left preview side */}
                    <div className="bg-slate-50 p-6 rounded-2xl border flex flex-col justify-between">
                        <div>
                            <span className="text-5xl font-black text-slate-900">£697</span>
                            <span className="text-lg text-slate-600 ml-2">per night</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 my-6">
                            <div className="h-48 bg-slate-200 rounded-xl overflow-hidden">
                                <img src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750" alt="Property" className="w-full h-full object-cover" />
                            </div>
                            <div className="h-48 bg-slate-200 rounded-xl overflow-hidden">
                                <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c" alt="Property" className="w-full h-full object-cover" />
                            </div>
                        </div>
                    </div>

                    {/* Right form side */}
                    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); alert('Listing submitted successfully!'); }}>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Title</label>
                            <input 
                                type="text" 
                                value={title} 
                                onChange={(e) => setTitle(e.target.value)} 
                                placeholder="Enter your title" 
                                className="mt-1 w-full p-3 border rounded-xl"
                                required 
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Countries</label>
                                <select 
                                    value={country} 
                                    onChange={(e) => setCountry(e.target.value)}
                                    className="mt-1 w-full p-3 border rounded-xl bg-white"
                                    required
                                >
                                    <option value="">--Select a country--</option>
                                    <option value="United Kingdom">United Kingdom</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">City</label>
                                <input 
                                    type="text" 
                                    value={city} 
                                    onChange={(e) => setCity(e.target.value)} 
                                    placeholder="Enter your city" 
                                    className="mt-1 w-full p-3 border rounded-xl"
                                    required 
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700">State</label>
                                <input 
                                    type="text" 
                                    value={state} 
                                    onChange={(e) => setState(e.target.value)} 
                                    placeholder="Enter your state" 
                                    className="mt-1 w-full p-3 border rounded-xl"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Price</label>
                                <input 
                                    type="number" 
                                    value={price} 
                                    onChange={(e) => setPrice(e.target.value)} 
                                    placeholder="Enter your price" 
                                    className="mt-1 w-full p-3 border rounded-xl"
                                    required 
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Image</label>
                            <input type="file" className="mt-1 w-full p-2 border rounded-xl text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Description</label>
                            <textarea 
                                value={description} 
                                onChange={(e) => setDescription(e.target.value)}
                                rows={4} 
                                placeholder="Describe your place..." 
                                className="mt-1 w-full p-3 border rounded-xl"
                            />
                        </div>
                        <button type="submit" className="w-full py-3 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition">
                            Submit
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // Logged in landing view (Image 3 style)
    return (
        <div className="max-w-4xl mx-auto px-6 py-16">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome back, {userName}</h1>
            <p className="text-lg text-slate-600 mb-8">Start a new listing</p>

            <div 
                onClick={() => setShowListingForm(true)}
                className="flex items-center justify-between p-6 border rounded-2xl shadow-sm hover:shadow-md transition cursor-pointer bg-white group"
            >
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-slate-100 rounded-xl group-hover:bg-rose-50 transition">
                        <HomeIcon className="w-6 h-6 text-slate-700 group-hover:text-rose-500" />
                    </div>
                    <span className="font-semibold text-lg text-slate-800">Create a new listing</span>
                </div>
                <ChevronRightIcon className="w-5 h-5 text-slate-400 group-hover:text-slate-800" />
            </div>
            <div className="border-t mt-6"></div>
        </div>
    );
}
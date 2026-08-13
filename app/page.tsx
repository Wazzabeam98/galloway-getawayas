'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const SAMPLE_ADDRESSES = [
    "EH17 8FD, Gilmerton Road, Edinburgh",
    "EH17 8AB, Morris Crescent, Edinburgh",
    "EH1 1YZ, High Street, Edinburgh",
    "G1 1XQ, George Square, Glasgow",
    "AB10 1XG, Union Street, Aberdeen",
    "10 Downing Street, London, SW1A 2AA",
    "42 Wallaby Way, Sydney"
];

const AddHome = () => {
    const router = useRouter();
    const supabase = createClientComponentClient();
    
    const [addressQuery, setAddressQuery] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [selectedAddress, setSelectedAddress] = useState('');
    
    // Form fields for the next steps or final submission
    const [title, setTitle] = useState('');
    const [price, setPrice] = useState('');
    const [description, setDescription] = useState('');
    const [country, setCountry] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [loading, setLoading] = useState(false);

    // Handle address typing and filtering suggestions
    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAddressQuery(value);

        if (value.trim().length > 0) {
            const filtered = SAMPLE_ADDRESSES.filter(addr => 
                addr.toLowerCase().includes(value.toLowerCase())
            );
            setSuggestions(filtered);
        } else {
            setSuggestions([]);
        }
    };

    const handleSelectSuggestion = (addr: string) => {
        setSelectedAddress(addr);
        setAddressQuery(addr);
        setSuggestions([]);
        
        // Automatically parse parts for your database fields if desired
        const parts = addr.split(',').map(p => p.trim());
        if (parts.length >= 3) {
            setCity(parts[parts.length - 1]);
            setState(parts[parts.length - 2]);
        }
    };

    return (
        <div className="min-h-screen bg-white flex flex-col justify-between">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b">
                <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push('/')}>
                    <div className="bg-rose-500 text-white font-bold p-2 rounded-xl text-lg">GG</div>
                    <span className="font-bold text-lg text-rose-500">Galloway Getaways</span>
                </div>
                <button 
                    onClick={() => router.push('/dashboard')} 
                    className="text-sm font-semibold text-slate-700 hover:underline"
                >
                    Exit
                </button>
            </header>

            {/* Main Content Layout matching Airbnb style */}
            <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 items-center px-8 lg:px-20 py-10 gap-12 max-w-7xl mx-auto w-full">
                {/* Left Column: Title & Address Search Bar */}
                <div className="space-y-6 relative">
                    <h1 className="text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
                        Set up your Galloway Getaways listing
                    </h1>
                    <p className="text-slate-600 text-lg">
                        It’s easy to create a great listing – let’s start with your address.
                    </p>

                    {/* Interactive Address Search Input with Dropdown */}
                    <div className="relative max-w-lg">
                        <div className="flex items-center border-2 border-slate-300 hover:border-slate-400 focus-within:border-slate-900 rounded-full px-5 py-4 shadow-sm transition bg-white">
                            <svg className="w-5 h-5 text-slate-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Enter your address (e.g., EH17 8FD)"
                                value={addressQuery}
                                onChange={handleAddressChange}
                                className="w-full outline-none text-slate-800 placeholder-slate-400 text-base bg-transparent"
                            />
                        </div>

                        {/* Auto-suggest dropdown */}
                        {suggestions.length > 0 && (
                            <ul className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-50 max-h-60 overflow-y-auto">
                                {suggestions.map((item, index) => (
                                    <li
                                        key={index}
                                        onClick={() => handleSelectSuggestion(item)}
                                        className="px-5 py-3 hover:bg-slate-100 cursor-pointer text-slate-700 text-sm flex items-center space-x-2 border-b last:border-none"
                                    >
                                        <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Right Column: Featured Image Box */}
                <div className="relative w-full h-[450px] rounded-3xl overflow-hidden shadow-2xl">
                    <img 
                        src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80" 
                        alt="Luxury property" 
                        className="w-full h-full object-cover"
                    />
                </div>
            </main>

            {/* Footer Navigation */}
            <footer className="px-8 py-6 border-t flex justify-between items-center max-w-7xl mx-auto w-full">
                <button 
                    onClick={() => router.push('/dashboard')}
                    className="font-semibold text-slate-800 underline hover:text-black"
                >
                    Back
                </button>
                <button
                    disabled={!selectedAddress}
                    onClick={() => {
                        // Once an address is picked, you can proceed to the next details step
                        alert(`Address selected: ${selectedAddress}`);
                    }}
                    className={`px-8 py-3 rounded-xl font-bold text-white transition ${
                        selectedAddress ? 'bg-slate-900 hover:bg-black cursor-pointer' : 'bg-slate-300 cursor-not-allowed'
                    }`}
                >
                    Next
                </button>
            </footer>
        </div>
    );
};

export default AddHome;
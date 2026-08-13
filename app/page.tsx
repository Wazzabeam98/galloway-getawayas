'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const SAMPLE_ADDRESSES = [
    { display: "EH17 8FD, Gilmerton Road, Edinburgh", street: "Gilmerton Road", town: "Edinburgh", postcode: "EH17 8FD" },
    { display: "EH17 8AB, Southhouse Place, Edinburgh", street: "Southhouse Place", town: "Edinburgh", postcode: "EH17 8AB" },
    { display: "EH1 1YZ, High Street, Edinburgh", street: "High Street", town: "Edinburgh", postcode: "EH1 1YZ" },
    { display: "G1 1XQ, George Square, Glasgow", street: "George Square", town: "Glasgow", postcode: "G1 1XQ" },
    { display: "AB10 1XG, Union Street, Aberdeen", street: "Union Street", town: "Aberdeen", postcode: "AB10 1XG" }
];

const AddHome = () => {
    const router = useRouter();
    const supabase = createClientComponentClient();
    
    const [addressQuery, setAddressQuery] = useState('');
    const [suggestions, setSuggestions] = useState<typeof SAMPLE_ADDRESSES>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Detailed address form fields mimicking Airbnb popup
    const [country, setCountry] = useState('United Kingdom - GB');
    const [flat, setFlat] = useState('');
    const [propertyName, setPropertyName] = useState('');
    const [street, setStreet] = useState('');
    const [locality, setLocality] = useState('');
    const [town, setTown] = useState('');
    const [postcode, setPostcode] = useState('');

    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAddressQuery(value);

        if (value.trim().length > 0) {
            const filtered = SAMPLE_ADDRESSES.filter(item => 
                item.display.toLowerCase().includes(value.toLowerCase()) ||
                item.postcode.toLowerCase().includes(value.toLowerCase())
            );
            setSuggestions(filtered);
        } else {
            setSuggestions([]);
        }
    };

    const handleSelectSuggestion = (item: typeof SAMPLE_ADDRESSES[0]) => {
        setAddressQuery(item.display);
        setSuggestions([]);
        
        // Populate modal fields
        setStreet(item.street);
        setTown(item.town);
        setPostcode(item.postcode);
        
        // Open the Airbnb-style confirmation modal
        setIsModalOpen(true);
    };

    return (
        <div className="min-h-screen bg-white flex flex-col justify-between relative">
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

            {/* Main Content Layout */}
            <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 items-center px-8 lg:px-20 py-10 gap-12 max-w-7xl mx-auto w-full">
                <div className="space-y-6 relative">
                    <h1 className="text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
                        Set up your Galloway Getaways listing
                    </h1>
                    <p className="text-slate-600 text-lg">
                        It’s easy to create a great listing – let’s start with your address.
                    </p>

                    <div className="relative max-w-lg">
                        <div className="flex items-center border-2 border-slate-300 hover:border-slate-400 focus-within:border-slate-900 rounded-full px-5 py-4 shadow-sm transition bg-white">
                            <svg className="w-5 h-5 text-slate-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Enter your address"
                                value={addressQuery}
                                onChange={handleAddressChange}
                                className="w-full outline-none text-slate-800 placeholder-slate-400 text-base bg-transparent"
                            />
                        </div>

                        {suggestions.length > 0 && (
                            <ul className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-30 max-h-60 overflow-y-auto">
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
                                        <span>{item.display}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="relative w-full h-[450px] rounded-3xl overflow-hidden shadow-2xl">
                    <img 
                        src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80" 
                        alt="Luxury property" 
                        className="w-full h-full object-cover"
                    />
                </div>
            </main>

            {/* Confirm Address Modal (Mimicking Airbnb Image 2) */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                    <div className="bg-white rounded-3xl max-w-xl w-full p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-4 border-b mb-6">
                            <button 
                                onClick={() => setIsModalOpen(false)}
                                className="text-slate-500 hover:text-black text-xl font-bold"
                            >
                                &larr;
                            </button>
                            <h2 className="text-lg font-bold text-slate-900">Confirm your address</h2>
                            <button 
                                onClick={() => setIsModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 font-bold text-xl"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 font-semibold uppercase">Country/region</label>
                                <select 
                                    value={country} 
                                    onChange={(e) => setCountry(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm bg-white font-medium text-slate-800 mt-1"
                                >
                                    <option>United Kingdom - GB</option>
                                    <option>United States - US</option>
                                    <option>Australia - AU</option>
                                </select>
                            </div>

                            <div>
                                <input
                                    type="text"
                                    placeholder="Flat, floor, bldg (if applicable)"
                                    value={flat}
                                    onChange={(e) => setFlat(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm text-slate-800 placeholder-slate-400"
                                />
                            </div>

                            <div>
                                <input
                                    type="text"
                                    placeholder="Property name (if applicable)"
                                    value={propertyName}
                                    onChange={(e) => setPropertyName(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm text-slate-800 placeholder-slate-400"
                                />
                            </div>

                            <div>
                                <input
                                    type="text"
                                    placeholder="Street address"
                                    value={street}
                                    onChange={(e) => setStreet(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm text-slate-800 placeholder-slate-400 font-medium"
                                />
                            </div>

                            <div>
                                <input
                                    type="text"
                                    placeholder="Locality (if applicable)"
                                    value={locality}
                                    onChange={(e) => setLocality(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm text-slate-800 placeholder-slate-400"
                                />
                            </div>

                            <div>
                                <input
                                    type="text"
                                    placeholder="Town / city"
                                    value={town}
                                    onChange={(e) => setTown(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm text-slate-800 placeholder-slate-400 font-medium"
                                />
                            </div>

                            <div>
                                <input
                                    type="text"
                                    placeholder="Postcode"
                                    value={postcode}
                                    onChange={(e) => setPostcode(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm text-slate-800 placeholder-slate-400 font-medium"
                                />
                            </div>
                        </div>

                        <div className="mt-8 pt-4 border-t flex justify-end">
                            <button
                                onClick={() => {
                                    setIsModalOpen(false);
                                    alert("Address confirmed! Moving to next step.");
                                }}
                                className="w-full py-4 bg-slate-900 hover:bg-black text-white font-bold rounded-xl transition"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AddHome;
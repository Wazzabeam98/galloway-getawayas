'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface PlaceResult {
    display_name: string;
    street?: string;
    town?: string;
    postcode?: string;
}

// Local Dumfries & Galloway fallback dataset to guarantee local lookups always work instantly
const DG_FALLBACK_DATABASE: PlaceResult[] = [
    { display_name: "28 Millburn Street, Kirkcudbright, DG6 4EA", street: "28 Millburn Street", town: "Kirkcudbright", postcode: "DG6 4EA" },
    { display_name: "9 Millburn Street, Kirkcudbright, DG6 4EB", street: "9 Millburn Street", town: "Kirkcudbright", postcode: "DG6 4EB" },
    { display_name: "High Street, Kirkcudbright, DG6 6AA", street: "High Street", town: "Kirkcudbright", postcode: "DG6 6AA" },
    { display_name: "Dock Park, Dumfries, DG1 1JA", street: "Dock Park", town: "Dumfries", postcode: "DG1 1JA" },
    { display_name: "The Avenue, Dumfries, DG1 2BZ", street: "The Avenue", town: "Dumfries", postcode: "DG1 2BZ" },
    { display_name: "Main Street, Stranraer, DG9 7JP", street: "Main Street", town: "Stranraer", postcode: "DG9 7JP" },
    { display_name: "High Street, Annan, DG12 6AA", street: "High Street", town: "Annan", postcode: "DG12 6AA" },
    { display_name: "Castle Street, Castle Douglas, DG7 1AD", street: "Castle Street", town: "Castle Douglas", postcode: "DG7 1AD" }
];

const AddHome = () => {
    const router = useRouter();
    const supabase = createClientComponentClient();
    
    const [addressQuery, setAddressQuery] = useState('');
    const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    // Detailed address form fields mimicking Airbnb popup
    const [country, setCountry] = useState('United Kingdom');
    const [flat, setFlat] = useState('');
    const [propertyName, setPropertyName] = useState('');
    const [street, setStreet] = useState('');
    const [locality, setLocality] = useState('Dumfries and Galloway');
    const [town, setTown] = useState('');
    const [postcode, setPostcode] = useState('');

    const handleAddressChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAddressQuery(value);

        if (value.trim().length > 1) {
            setLoading(true);
            const queryLower = value.toLowerCase();

            // 1. Search local Dumfries & Galloway database first
            const matchedLocal = DG_FALLBACK_DATABASE.filter(item => 
                item.display_name.toLowerCase().includes(queryLower) ||
                (item.postcode && item.postcode.toLowerCase().includes(queryLower))
            );

            let liveResults: PlaceResult[] = [];

            try {
                // 2. Query OpenStreetMap live database for the UK
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(value)}&countrycodes=gb&limit=10`,
                    { headers: { 'User-Agent': 'GallowayGetawaysApp/1.0' } }
                );
                const data = await response.json();

                // STRICT FILTER: Only allow results inside Dumfries & Galloway or matching DG postcodes
                liveResults = data
                    .filter((item: any) => {
                        const name = item.display_name.toLowerCase();
                        const pc = item.address?.postcode?.toUpperCase() || '';
                        return pc.startsWith('DG') || 
                               name.includes('dumfries') || 
                               name.includes('galloway') || 
                               name.includes('kirkcudbright') || 
                               name.includes('stranraer') || 
                               name.includes('annan') || 
                               name.includes('lockerbie') || 
                               name.includes('moffat') ||
                               name.includes('castle douglas') ||
                               name.includes('dalbeattie') ||
                               name.includes('newton stewart');
                    })
                    .map((item: any) => ({
                        display_name: item.display_name,
                        street: [item.address?.house_number, item.address?.road].filter(Boolean).join(' ') || item.display_name.split(',')[0],
                        town: item.address?.city || item.address?.town || item.address?.village || 'Dumfries and Galloway',
                        postcode: item.address?.postcode || ''
                    }));
            } catch (err) {
                console.error("Live fetch error:", err);
            }

            // Combine local + live results, dropping duplicates
            const combined = [...matchedLocal, ...liveResults];
            const unique = Array.from(new Set(combined.map(s => s.display_name)))
                .map(name => combined.find(s => s.display_name === name)) as PlaceResult[];

            setSuggestions(unique);
            setLoading(false);
        } else {
            setSuggestions([]);
        }
    };

    const handleSelectSuggestion = (place: PlaceResult) => {
        setAddressQuery(place.display_name);
        setSuggestions([]);
        
        setStreet(place.street || place.display_name.split(',')[0]);
        setTown(place.town || 'Dumfries and Galloway');
        setPostcode(place.postcode || '');
        setLocality('Dumfries and Galloway');
        
        setIsModalOpen(true);
    };

    // Fallback if address cannot be found automatically in public databases
    const handleManualEntry = () => {
        setStreet(addressQuery);
        setTown('');
        setPostcode('');
        setSuggestions([]);
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
                                placeholder="Enter DG postcode or street (e.g. DG1, Millburn Street)"
                                value={addressQuery}
                                onChange={handleAddressChange}
                                className="w-full outline-none text-slate-800 placeholder-slate-400 text-base bg-transparent"
                            />
                            {loading && <div className="text-xs text-slate-400 animate-pulse ml-2">Searching...</div>}
                        </div>

                        {/* Dropdown Suggestions or Manual Entry Fallback */}
                        {addressQuery.trim().length > 1 && (
                            <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-30 max-h-60 overflow-y-auto">
                                {suggestions.length > 0 ? (
                                    <ul>
                                        {suggestions.map((item, index) => (
                                            <li
                                                key={index}
                                                onClick={() => handleSelectSuggestion(item)}
                                                className="px-5 py-3 hover:bg-slate-100 cursor-pointer text-slate-700 text-sm flex items-center space-x-3 border-b last:border-none"
                                            >
                                                <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                </svg>
                                                <span className="truncate">{item.display_name}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="p-4 text-center">
                                        <p className="text-xs text-slate-500 mb-2">Can't find your exact address in public maps?</p>
                                        <button
                                            onClick={handleManualEntry}
                                            className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-lg transition"
                                        >
                                            Enter "{addressQuery}" manually & continue &rarr;
                                        </button>
                                    </div>
                                )}
                            </div>
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

            {/* Confirm Address Modal (Airbnb Style) */}
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
                                <input 
                                    type="text"
                                    value={country} 
                                    onChange={(e) => setCountry(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm bg-white font-medium text-slate-800 mt-1"
                                />
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
                                    placeholder="Locality / Region"
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
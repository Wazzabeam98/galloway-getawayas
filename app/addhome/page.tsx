'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import Logo from '@/components/base/Logo';
import { HomeIcon, ChevronRightIcon } from 'lucide-react';
import LoginModel from '@/components/auth/LoginModel';

interface PlaceResult {
    display_name: string;
    street?: string;
    town?: string;
    postcode?: string;
}

export default function AddHome() {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [userName, setUserName] = useState('');
    const [showListingForm, setShowListingForm] = useState(false);
    
    // Listing form state
    const [title, setTitle] = useState('');
    const [price, setPrice] = useState('');
    const [country, setCountry] = useState('United Kingdom');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [description, setDescription] = useState('');

    // Address search & modal state
    const [addressQuery, setAddressQuery] = useState('');
    const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [flat, setFlat] = useState('');
    const [propertyName, setPropertyName] = useState('');
    const [street, setStreet] = useState('');
    const [locality, setLocality] = useState('Dumfries and Galloway');
    const [postcode, setPostcode] = useState('');

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

    const handleAddressChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAddressQuery(value);

        if (value.trim().length > 1) {
            setLoading(true);
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(value)}&countrycodes=gb&limit=10`,
                    { headers: { 'User-Agent': 'GallowayGetawaysApp/1.0' } }
                );
                const data = await response.json();

                const liveResults = data
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

                setSuggestions(liveResults);
            } catch (err) {
                console.error("Live fetch error:", err);
                setSuggestions([]);
            } finally {
                setLoading(false);
            }
        } else {
            setSuggestions([]);
        }
    };

    const handleSelectSuggestion = (place: PlaceResult) => {
        setAddressQuery(place.display_name);
        setSuggestions([]);
        
        setStreet(place.street || place.display_name.split(',')[0]);
        setCity(place.town || 'Dumfries and Galloway');
        setPostcode(place.postcode || '');
        setLocality('Dumfries and Galloway');
        
        setIsModalOpen(true);
    };

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

    // If user clicked "Create a new listing", show the listing form view with your local garden image
    if (showListingForm) {
        return (
            <div className="min-h-screen bg-white flex flex-col justify-between relative">
                {/* Top Main Navigation Bar */}
                <header className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push('/')}>
                        <div className="bg-rose-500 text-white font-bold p-2 rounded-xl text-lg">GG</div>
                        <span className="font-bold text-lg text-slate-900">Galloway Getaways</span>
                    </div>
                    <div className="flex items-center space-x-4">
                        <span className="text-sm font-semibold text-slate-800">Become a host</span>
                        <button 
                            onClick={() => setShowListingForm(false)} 
                            className="text-sm font-semibold text-slate-700 hover:underline px-3 py-1.5 border rounded-full"
                        >
                            Exit
                        </button>
                    </div>
                </header>

                <div className="max-w-6xl mx-auto px-6 py-10 w-full flex-1">
                    <div className="flex justify-between items-center mb-8">
                        <h1 className="text-3xl font-extrabold text-rose-500">
                            Galloway Getaways <span className="text-slate-900 font-normal text-xl block">You could earn per night</span>
                        </h1>
                        <button 
                            onClick={() => setShowListingForm(false)}
                            className="text-sm font-semibold underline text-slate-600 hover:text-black"
                        >
                            Back to dashboard
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {/* Left preview side containing your local uploaded garden image */}
                        <div className="bg-slate-50 p-6 rounded-2xl border flex flex-col justify-between">
                            <div>
                                <span className="text-5xl font-black text-slate-900">£697</span>
                                <span className="text-lg text-slate-600 ml-2">per night</span>
                            </div>
                            <div className="my-6">
                                <div className="h-80 bg-slate-200 rounded-2xl overflow-hidden shadow-lg">
                                    <img 
                                        src="/images/garden.avif" 
                                        alt="Property Garden with Hot Tub" 
                                        className="w-full h-full object-cover" 
                                    />
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
            </div>
        );
    }

    // Default logged in landing view with address search layout and your local garden image
    return (
        <div className="min-h-screen bg-white flex flex-col justify-between relative">
            {/* Top Main Navigation Bar */}
            <header className="flex items-center justify-between px-6 py-4 border-b">
                <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push('/')}>
                    <div className="bg-rose-500 text-white font-bold p-2 rounded-xl text-lg">GG</div>
                    <span className="font-bold text-lg text-slate-900">Galloway Getaways</span>
                </div>
                <div className="flex items-center space-x-4">
                    <span className="text-sm font-semibold text-slate-800">Welcome, {userName}</span>
                    <button 
                        onClick={() => router.push('/dashboard')} 
                        className="text-sm font-semibold text-slate-700 hover:underline px-3 py-1.5 border rounded-full"
                    >
                        Dashboard
                    </button>
                </div>
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

                        {/* Dropdown Suggestions */}
                        {suggestions.length > 0 && (
                            <ul className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-30 max-h-60 overflow-y-auto">
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
                        )}
                    </div>

                    <div 
                        onClick={() => setShowListingForm(true)}
                        className="flex items-center justify-between p-4 border rounded-2xl shadow-sm hover:shadow-md transition cursor-pointer bg-white group max-w-lg mt-6"
                    >
                        <div className="flex items-center space-x-4">
                            <div className="p-3 bg-slate-100 rounded-xl group-hover:bg-rose-50 transition">
                                <HomeIcon className="w-6 h-6 text-slate-700 group-hover:text-rose-500" />
                            </div>
                            <span className="font-semibold text-base text-slate-800">Or skip to manual listing form</span>
                        </div>
                        <ChevronRightIcon className="w-5 h-5 text-slate-400 group-hover:text-slate-800" />
                    </div>
                </div>

                {/* Local Uploaded Image Reference (/images/garden.avif) */}
                <div className="relative w-full h-[480px] rounded-3xl overflow-hidden shadow-2xl">
                    <img 
                        src="/images/garden.avif" 
                        alt="Property Garden with Hot Tub" 
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
                                    value={city}
                                    onChange={(e) => setCity(e.target.value)}
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
                                    setShowListingForm(true);
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
}
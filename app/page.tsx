'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { Search, Home } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';

interface Property {
    id: string;
    title: string;
    location: string;
    price_per_night: number;
    images: string[] | null;
}

export default function HomeExplore() {
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchLocation, setSearchLocation] = useState('');
    const router = useRouter();
    const supabase = createClientComponentClient();

    useEffect(() => {
        const fetchProperties = async () => {
            const { data, error } = await supabase
                .from('listings')
                .select('id, title, location, price_per_night, images')
                .order('created_at', { ascending: false });
            if (error) {
                console.error('Error fetching properties:', error);
            } else {
                setProperties(data || []);
            }
            setLoading(false);
        };

        fetchProperties();
    }, [supabase]);

    return (
        <div className="min-h-screen bg-white">
            {/* Search Bar Header Section */}
            <div className="max-w-4xl mx-auto px-6 py-6">
                <div className="flex items-center justify-between border rounded-full shadow-lg py-3 px-6 bg-white hover:shadow-xl transition cursor-pointer">
                    <div className="flex flex-col border-r pr-6 flex-1">
                        <span className="text-xs font-bold text-slate-800">Where</span>
                        <input 
                            type="text" 
                            placeholder="Search destinations (e.g. Dumfries)" 
                            value={searchLocation}
                            onChange={(e) => setSearchLocation(e.target.value)}
                            className="outline-none text-sm text-slate-600 bg-transparent placeholder-slate-400"
                        />
                    </div>
                    <div className="flex flex-col border-r px-6 flex-1">
                        <span className="text-xs font-bold text-slate-800">Check in</span>
                        <span className="text-sm text-slate-400">Add dates</span>
                    </div>
                    <div className="flex flex-col border-r px-6 flex-1">
                        <span className="text-xs font-bold text-slate-800">Check out</span>
                        <span className="text-sm text-slate-400">Add dates</span>
                    </div>
                    <div className="flex items-center justify-between pl-6 flex-1">
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-800">Who</span>
                            <span className="text-sm text-slate-400">Add guests</span>
                        </div>
                        <button className="bg-rose-500 text-white p-3 rounded-full hover:bg-rose-600 transition flex items-center justify-center">
                            <Search className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Properties Grid */}
            <div className="max-w-7xl mx-auto px-6 py-10">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Explore Galloway Getaways</h2>
                {loading ? (
                    <div className="text-center py-20 text-slate-500 animate-pulse">Loading amazing places...</div>
                ) : properties.length === 0 ? (
                    <div className="text-center py-20 text-slate-500">No properties found yet. Be the first to host!</div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {properties.map((property) => (
                            <div 
                                key={property.id} 
                                onClick={() => router.push(`/homes/${property.id}`)}
                                className="group cursor-pointer flex flex-col space-y-2"
                            >
                                <div className="w-full h-64 rounded-2xl overflow-hidden bg-slate-200 relative">
                                    {property.images && property.images.length > 0 ? (
                                        <img 
                                            src={getImageUrl(property.images[0])} 
                                            alt={property.title} 
                                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-slate-400">
                                            <Home className="w-10 h-10" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-slate-900 text-base truncate">{property.location}</h3>
                                </div>
                                <p className="text-sm text-slate-500 truncate">{property.title}</p>
                                <p className="text-sm font-semibold text-slate-900">
                                    £{property.price_per_night} <span className="font-normal text-slate-500">night</span>
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

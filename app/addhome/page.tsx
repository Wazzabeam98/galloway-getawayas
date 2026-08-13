'use client';

import { useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import Logo from '@/components/base/Logo';
import { HomeIcon, ChevronRightIcon, ChevronLeftIcon, Trees, Waves, Compass, Building2, Sparkles, Minus, Plus, Check } from 'lucide-react';
import LoginModel from '@/components/auth/LoginModel';
import { categories } from '@/config/categories';
import Env from '@/config/Env';
import { generateRandomNumber } from '@/lib/utils';
import { toast } from 'react-toastify';

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
    const [homeCategories, setHomeCategories] = useState<string[]>([]);
    const [image, setImage] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');

    // Airbnb-style wizard state
    const [step, setStep] = useState(1);
    const TOTAL_STEPS = 8;
    const [propertyType, setPropertyType] = useState('');
    const [privacyType, setPrivacyType] = useState('Entire place');
    const [guests, setGuests] = useState(1);
    const [bedrooms, setBedrooms] = useState(1);
    const [beds, setBeds] = useState(1);
    const [bathrooms, setBathrooms] = useState(1);
    const [amenities, setAmenities] = useState<string[]>([]);

    const AMENITIES = [
        'Wifi', 'Kitchen', 'Free parking', 'Hot tub', 'Pool', 'Washer',
        'Dryer', 'Air conditioning', 'Heating', 'TV', 'Fireplace',
        'Workspace', 'Garden', 'BBQ grill'
    ];

    const ICON_MAP: Record<string, any> = { Home: HomeIcon, Trees, Waves, Compass, Building2, Sparkles };

    // Address search & modal state
    const [addressQuery, setAddressQuery] = useState('');
    const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [flat, setFlat] = useState('');
    const [propertyName, setPropertyName] = useState('');
    const [street, setStreet] = useState('');
    const [locality, setLocality] = useState('Dumfries and Galloway');
    const [postcode, setPostcode] = useState('');
    const [addressLoading, setAddressLoading] = useState(false);

    const router = useRouter();
    const supabase = createClientComponentClient();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAddressQuery(value);

        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (value.trim().length <= 1) {
            setSuggestions([]);
            setAddressLoading(false);
            return;
        }

        setAddressLoading(true);
        debounceRef.current = setTimeout(async () => {
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
                setAddressLoading(false);
            }
        }, 400);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) setImage(file);
    };

    const handleListingSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (!image) {
            setFormError('Please choose a photo of your place.');
            return;
        }
        if (!['image/jpeg', 'image/jpg', 'image/png'].includes(image.type)) {
            setFormError('Only JPEG, JPG and PNG images are allowed.');
            return;
        }
        if (image.size / 1048576 >= 2) {
            setFormError('Image size must be less than 2MB.');
            return;
        }

        setSubmitting(true);

        const user = await supabase.auth.getUser();
        if (!user.data.user) {
            toast.error('You need to be signed in to publish a listing.', { theme: 'colored' });
            setSubmitting(false);
            return;
        }

        const uniquePath = Date.now() + '_' + generateRandomNumber();
        const { data: imgData, error: imgErr } = await supabase.storage
            .from(Env.S3_BUCKET)
            .upload(uniquePath, image);

        if (imgErr) {
            toast.error(imgErr.message, { theme: 'colored' });
            setSubmitting(false);
            return;
        }

        // Your listings table stores the address as one combined text field,
        // not separate country/state/city columns — build that here.
        const location = [flat, propertyName, street, city, state, postcode, country]
            .filter(Boolean)
            .join(', ');

        const { error: listingErr } = await supabase.from('listings').insert({
            host_id: user.data.user.id,
            title,
            description,
            location,
            price_per_night: Number(price),
            max_guests: guests,
            images: imgData?.path ? [imgData.path] : [],
            property_type: propertyType,
            privacy_type: privacyType,
            bedrooms,
            beds,
            bathrooms,
            amenities,
        });

        if (listingErr) {
            toast.error(listingErr.message, { theme: 'colored' });
            setSubmitting(false);
            return;
        }

        router.push('/dashboard?success=Home added successfully!');
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
    if (showListingForm) {
        const goBack = () => {
            setFormError('');
            if (step > 1) setStep(step - 1);
            else setShowListingForm(false);
        };

        const goNext = () => {
            setFormError('');
            if (step === 1 && !propertyType) {
                setFormError('Please choose a property type to continue.');
                return;
            }
            if (step === 3 && (!city || !state)) {
                setFormError('Please fill in your town/city and region.');
                return;
            }
            if (step === 6 && !image) {
                setFormError('Please add a photo of your place.');
                return;
            }
            if (step === 7 && (!title || !description)) {
                setFormError('Please add a title and description.');
                return;
            }
            setStep(step + 1);
        };

        const toggleAmenity = (name: string) => {
            setAmenities((prev) =>
                prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]
            );
        };

        const Counter = ({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (v: number) => void; min?: number }) => (
            <div className="flex items-center justify-between py-4 border-b">
                <span
                    {/* Step 8: Price + review */}
                {step === 8 && (
                    <form onSubmit={handleListingSubmit}>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Now, set your price</h2>
                        <p className="text-slate-600 mb-6">You can change this anytime.</p>
                        <div className="flex items-center border-2 rounded-2xl px-5 py-4 mb-8 max-w-xs">
                            <span className="text-3xl font-black text-slate-900 mr-2">£</span>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0"
                                className="text-3xl font-black text-slate-900 outline-none w-full"
                                required
                            />
                            <span className="text-slate-500 ml-2">/ night</span>
                        </div>

                        <div className="bg-slate-50 rounded-2xl border p-6 mb-6">

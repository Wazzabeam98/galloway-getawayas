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
    const [photos, setPhotos] = useState<File[]>([]);
    const [coverIndex, setCoverIndex] = useState(0);
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

    // Hosts absorb this fee — guests always pay exactly the nightly rate the
    // host sets, with no extra charge added at checkout.
    const HOST_FEE_PERCENT = 10;

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

    const handlePhotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length) setPhotos((prev) => [...prev, ...files]);
        e.target.value = '';
    };

    const removePhoto = (index: number) => {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
        setCoverIndex((prev) => {
            if (index === prev) return 0;
            if (index < prev) return prev - 1;
            return prev;
        });
    };

    const handleListingSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (photos.length === 0) {
            setFormError('Please add at least one photo of your place.');
            return;
        }
        const badType = photos.find((p) => !['image/jpeg', 'image/jpg', 'image/png'].includes(p.type));
        if (badType) {
            setFormError('Only JPEG, JPG and PNG images are allowed.');
            return;
        }
        const tooBig = photos.find((p) => p.size / 1048576 >= 2);
        if (tooBig) {
            setFormError('Each photo must be less than 2MB.');
            return;
        }

        setSubmitting(true);

        const user = await supabase.auth.getUser();
        if (!user.data.user) {
            toast.error('You need to be signed in to publish a listing.', { theme: 'colored' });
            setSubmitting(false);
            return;
        }

        // Upload every photo, cover photo first so it lands at images[0].
        const orderedPhotos = [photos[coverIndex], ...photos.filter((_, i) => i !== coverIndex)];
        const uploadedPaths: string[] = [];
        for (const photo of orderedPhotos) {
            const uniquePath = Date.now() + '_' + generateRandomNumber();
            const { data: imgData, error: imgErr } = await supabase.storage
                .from(Env.S3_BUCKET)
                .upload(uniquePath, photo);

            if (imgErr) {
                toast.error(imgErr.message, { theme: 'colored' });
                setSubmitting(false);
                return;
            }
            if (imgData?.path) uploadedPaths.push(imgData.path);
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
            images: uploadedPaths,
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
            if (step === 6 && photos.length === 0) {
                setFormError('Please add at least one photo of your place.');
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
                <span className="font-medium text-slate-800">{label}</span>
                <div className="flex items-center space-x-4">
                    <button
                        type="button"
                        onClick={() => onChange(Math.max(min, value - 1))}
                        className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30"
                        disabled={value <= min}
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-6 text-center">{value}</span>
                    <button
                        type="button"
                        onClick={() => onChange(value + 1)}
                        className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );

        return (
            <div className="max-w-3xl mx-auto px-6 py-10 w-full">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-extrabold text-rose-500">Galloway Getaways</h1>
                    <button
                        onClick={() => setShowListingForm(false)}
                        className="text-sm font-semibold underline text-slate-600 hover:text-black"
                    >
                        Back to dashboard
                    </button>
                </div>

                {/* Progress bar */}
                <div className="flex space-x-1 mb-10">
                    {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                        <div
                            key={i}
                            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-rose-500' : 'bg-slate-200'}`}
                        />
                    ))}
                </div>

                {/* Step 1: Property type */}
                {step === 1 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Which of these best describes your place?</h2>
                        <p className="text-slate-600 mb-8">Pick the closest match — you can fine-tune details later.</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {categories.map((item) => {
                                const Icon = ICON_MAP[item.icon] || HomeIcon;
                                const selected = propertyType === item.name;
                                return (
                                    <button
                                        key={item.name}
                                        type="button"
                                        onClick={() => {
                                            setPropertyType(item.name);
                                            setHomeCategories([item.name]);
                                        }}
                                        className={`p-5 rounded-2xl border-2 text-left transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                    >
                                        <Icon className="w-6 h-6 mb-3 text-slate-700" />
                                        <div className="font-semibold text-slate-900">{item.name}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 2: Privacy type */}
                {step === 2 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">What will guests have?</h2>
                        <p className="text-slate-600 mb-8">Choose how much of the place guests get.</p>
                        <div className="space-y-4">
                            {['Entire place', 'A private room', 'A shared room'].map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => setPrivacyType(option)}
                                    className={`w-full p-5 rounded-2xl border-2 text-left transition flex items-center justify-between ${privacyType === option ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                >
                                    <span className="font-semibold text-slate-900">{option}</span>
                                    {privacyType === option && <Check className="w-5 h-5 text-slate-900" />}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Location */}
                {step === 3 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Confirm your location</h2>
                        <p className="text-slate-600 mb-8">This is what we found from your address search — check it over.</p>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 font-semibold uppercase">Street address</label>
                                <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} className="w-full p-3 border rounded-xl mt-1" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Town / city</label>
                                    <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full p-3 border rounded-xl mt-1" required />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Region</label>
                                    <input type="text" value={state} onChange={(e) => setState(e.target.value)} className="w-full p-3 border rounded-xl mt-1" required />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Postcode</label>
                                    <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="w-full p-3 border rounded-xl mt-1" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Country</label>
                                    <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className="w-full p-3 border rounded-xl mt-1" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 4: Capacity */}
                {step === 4 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Share some basics about your place</h2>
                        <p className="text-slate-600 mb-8">You'll add more details later. For now, let's cover the essentials.</p>
                        <div>
                            <Counter label="Guests" value={guests} onChange={setGuests} min={1} />
                            <Counter label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={0} />
                            <Counter label="Beds" value={beds} onChange={setBeds} min={1} />
                            <Counter label="Bathrooms" value={bathrooms} onChange={setBathrooms} min={0.5} />
                        </div>
                    </div>
                )}

                {/* Step 5: Amenities */}
                {step === 5 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Tell guests what your place offers</h2>
                        <p className="text-slate-600 mb-8">Select all the amenities you provide.</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {AMENITIES.map((item) => {
                                const selected = amenities.includes(item);
                                return (
                                    <button
                                        key={item}
                                        type="button"
                                        onClick={() => toggleAmenity(item)}
                                        className={`p-4 rounded-2xl border-2 text-left text-sm font-medium transition flex items-center justify-between ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                    >
                                        {item}
                                        {selected && <Check className="w-4 h-4 text-slate-900" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 6: Photos */}
                {step === 6 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Add photos of your place</h2>
                        <p className="text-slate-600 mb-8">Upload as many as you like, then click the star on your favourite to make it the cover photo guests see first.</p>

                        {photos.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                                {photos.map((photo, i) => (
                                    <div
                                        key={i}
                                        className={`relative h-40 rounded-2xl overflow-hidden border-2 group ${i === coverIndex ? 'border-rose-500' : 'border-slate-200'}`}
                                    >
                                        <img
                                            src={URL.createObjectURL(photo)}
                                            alt={`Photo ${i + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setCoverIndex(i)}
                                            title={i === coverIndex ? 'Cover photo' : 'Make cover photo'}
                                            className={`absolute top-2 left-2 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow ${i === coverIndex ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-600 opacity-0 group-hover:opacity-100 transition'}`}
                                        >
                                            ★
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removePhoto(i)}
                                            title="Remove photo"
                                            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-600 flex items-center justify-center text-sm shadow opacity-0 group-hover:opacity-100 transition"
                                        >
                                            ×
                                        </button>
                                        {i === coverIndex && (
                                            <span className="absolute bottom-2 left-2 text-xs font-semibold bg-rose-500 text-white px-2 py-0.5 rounded-full">
                                                Cover photo
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <label className="h-32 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer text-slate-500 text-sm">
                            <span className="font-semibold mb-1">+ Add photos</span>
                            <span>JPEG or PNG, up to 2MB each</span>
                            <input
                                type="file"
                                accept="image/png, image/jpeg"
                                multiple
                                onChange={handlePhotosChange}
                                className="hidden"
                            />
                        </label>
                    </div>
                )}

                {/* Step 7: Title & description */}
                {step === 7 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Give your place a title</h2>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Cosy stone cottage near the coast"
                                className="w-full p-4 border rounded-xl text-lg"
                            />
                        </div>
                        <div>
                            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Describe your place</h2>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={5}
                                placeholder="What makes your place special?"
                                className="w-full p-4 border rounded-xl"
                            />
                        </div>
                    </div>
                )}

                {/* Step 8: Price + review */}
                {step === 8 && (
                    <form onSubmit={handleListingSubmit}>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Now, set your price</h2>
                        <p className="text-slate-600 mb-6">You can change this anytime.</p>
                        <div className="flex items-center border-2 rounded-2xl px-5 py-4 mb-3 max-w-xs">
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

                        {Number(price) > 0 && (
                            <div className="bg-slate-50 rounded-2xl border p-5 mb-8 max-w-xs text-sm">
                                <div className="flex justify-between text-slate-600 mb-2">
                                    <span>Guest pays</span>
                                    <span className="font-medium text-slate-900">£{Number(price).toFixed(2)} / night</span>
                                </div>
                                <div className="flex justify-between text-slate-600 mb-2">
                                    <span>Host fee ({HOST_FEE_PERCENT}%)</span>
                                    <span className="font-medium text-slate-900">
                                        − £{(Number(price) * HOST_FEE_PERCENT / 100).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between pt-2 border-t border-slate-200">
                                    <span className="font-semibold text-slate-900">You receive</span>
                                    <span className="font-bold text-rose-500">
                                        £{(Number(price) * (1 - HOST_FEE_PERCENT / 100)).toFixed(2)} / night
                                    </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-3">
                                    Guests are never charged extra — this {HOST_FEE_PERCENT}% covers payment processing and platform costs, deducted from your payout.
                                </p>
                            </div>
                        )}

                        <div className="bg-slate-50 rounded-2xl border p-6 mb-6">
                            <h3 className="font-bold text-slate-900 mb-3">Review your listing</h3>
                            <ul className="text-sm text-slate-600 space-y-1">
                                <li><span className="font-medium text-slate-800">Type:</span> {propertyType || '—'} · {privacyType}</li>
                                <li><span className="font-medium text-slate-800">Location:</span> {[street, city, state, postcode].filter(Boolean).join(', ') || '—'}</li>
                                <li><span className="font-medium text-slate-800">Guests:</span> {guests} · {bedrooms} bedrooms · {beds} beds · {bathrooms} bathrooms</li>
                                <li><span className="font-medium text-slate-800">Amenities:</span> {amenities.length ? amenities.join(', ') : 'None selected'}</li>
                                <li><span className="font-medium text-slate-800">Title:</span> {title || '—'}</li>
                            </ul>
                        </div>

                        {formError && <p className="text-red-600 text-sm mb-4">{formError}</p>}

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-4 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition disabled:opacity-60"
                        >
                            {submitting ? 'Publishing...' : 'Publish listing'}
                        </button>
                    </form>
                )}

                {formError && step !== 8 && <p className="text-red-600 text-sm mt-6">{formError}</p>}

                {/* Nav buttons (steps 1-7; step 8 has its own submit button above) */}
                {step !== 8 && (
                    <div className="flex justify-between items-center mt-10 pt-6 border-t">
                        <button
                            type="button"
                            onClick={goBack}
                            className="flex items-center text-sm font-semibold text-slate-700 hover:text-black"
                        >
                            <ChevronLeftIcon className="w-4 h-4 mr-1" /> Back
                        </button>
                        <button
                            type="button"
                            onClick={goNext}
                            className="px-8 py-3 bg-slate-900 hover:bg-black text-white font-bold rounded-xl transition"
                        >
                            Next
                        </button>
                    </div>
                )}
                {step === 8 && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex items-center text-sm font-semibold text-slate-700 hover:text-black mt-6"
                    >
                        <ChevronLeftIcon className="w-4 h-4 mr-1" /> Back
                    </button>
                )}
            </div>
        );
    }

    return (
        <main className="grid grid-cols-1 lg:grid-cols-2 items-center px-8 lg:px-20 py-10 gap-12 max-w-7xl mx-auto w-full">
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
                        {addressLoading && <div className="text-xs text-slate-400 animate-pulse ml-2">Searching...</div>}
                    </div>

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

            <div className="relative w-full h-[480px] rounded-3xl overflow-hidden shadow-2xl">
                <img 
                    src="/images/garden.avif" 
                    alt="Property Garden with Hot Tub" 
                    className="w-full h-full object-cover"
                />
            </div>

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
                                    setState(locality);
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
        </main>
    );
}

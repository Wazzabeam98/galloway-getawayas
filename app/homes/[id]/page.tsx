export const dynamic = "force-dynamic";
import React from 'react'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers';
import Navbar from '@/components/base/Navbar';
import Image from 'next/image';
import { capitializeFirst, getImageUrl } from '@/lib/utils';

const FindHome = async ({ params }: { params: { id: string } }) => {
    const supabase = createServerComponentClient({ cookies });

    const { data: home } = await supabase
        .from('listings')
        .select('*')
        .eq('id', params.id)
        .single();

    let hostName = 'Host';
    if (home?.host_id) {
        const { data: hostProfile } = await supabase
            .from('profiles')
            .select('full_name, preferred_name')
            .eq('id', home.host_id)
            .single();
        hostName = hostProfile?.preferred_name || hostProfile?.full_name || 'Host';
    }

    if (!home) {
        return (
            <div className='container mb-10'>
                <Navbar />
                <div className='container mt-10 text-center text-slate-500'>
                    This listing couldn't be found.
                </div>
            </div>
        );
    }

    const images: string[] = home.images || [];

    return (
        <div className='container mb-10'>
            <Navbar />
            <div className='container mt-4'>
                <h1 className='text-2xl font-bold'>{home.title}</h1>
                <p className='text-slate-600'>{home.location}</p>

                {images.length > 0 ? (
                    <Image
                        src={getImageUrl(images[0])}
                        width={100}
                        height={100}
                        alt='home_image'
                        className='rounded-lg w-full h-[500px] object-cover object-center my-3'
                        unoptimized
                    />
                ) : (
                    <div className='rounded-lg w-full h-[500px] bg-slate-100 flex items-center justify-center text-slate-400 my-3'>
                        No photo available
                    </div>
                )}

                {images.length > 1 && (
                    <div className='grid grid-cols-4 gap-2 mb-5'>
                        {images.slice(1).map((img, i) => (
                            <Image
                                key={i}
                                src={getImageUrl(img)}
                                width={100}
                                height={100}
                                alt={`home_image_${i + 2}`}
                                className='rounded-lg w-full h-24 object-cover'
                                unoptimized
                            />
                        ))}
                    </div>
                )}

                <h1 className='mt-5 text-2xl font-bold text-brand'>
                    Hosted by {capitializeFirst(hostName)}
                </h1>

                <p className='mt-2 text-slate-600'>
                    {home.max_guests} guests · {home.bedrooms} bedrooms · {home.beds} beds · {home.bathrooms} bathrooms
                </p>

                <p className='mt-3 text-2xl font-bold'>
                    £{home.price_per_night} <span className='text-base font-normal text-slate-500'>/ night</span>
                </p>

                {home.amenities && home.amenities.length > 0 && (
                    <div className='mt-5'>
                        <h2 className='text-xl font-semibold mb-2'>What this place offers</h2>
                        <div className='flex flex-wrap gap-2'>
                            {home.amenities.map((a: string) => (
                                <span key={a} className='text-sm bg-slate-100 px-3 py-1 rounded-full'>{a}</span>
                            ))}
                        </div>
                    </div>
                )}

                <h1 className='mt-5 font-semibold text-2xl'>
                    About this place
                </h1>
                <div className='mt-2 whitespace-pre-line'>
                    {home.description}
                </div>
            </div>
        </div>
    )
}

export default FindHome

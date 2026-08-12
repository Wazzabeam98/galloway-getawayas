'use client';

import React from 'react';

const Hero = () => {
  return (
    <div className="relative w-full h-[450px] md:h-[520px] flex items-center justify-center bg-stone-900 text-white overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-60"
        style={{ 
          backgroundImage: `url('https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?q=80&w=1600&auto=format&fit=crop')` 
        }}
      />

      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl px-4 flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3 drop-shadow-md">
          Galloway Getaways
        </h1>
        <p className="text-lg md:text-xl font-medium mb-8 drop-shadow text-emerald-100">
          Book direct for our best rate guarantee & lower booking fees
        </p>

        {/* Search Bar Overlay */}
        <div className="w-full max-w-3xl bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl text-stone-800 grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
          <div className="px-3 py-2 text-left border-b md:border-b-0 md:border-r border-stone-200">
            <label className="block text-xs font-semibold uppercase text-stone-500">Location</label>
            <input 
              type="text" 
              placeholder="All locations" 
              className="w-full bg-transparent text-sm focus:outline-none font-medium text-stone-900 placeholder-stone-400"
            />
          </div>

          <div className="px-3 py-2 text-left border-b md:border-b-0 md:border-r border-stone-200">
            <label className="block text-xs font-semibold uppercase text-stone-500">Dates</label>
            <input 
              type="text" 
              placeholder="Check-in → Check-out" 
              className="w-full bg-transparent text-sm focus:outline-none font-medium text-stone-900 placeholder-stone-400"
            />
          </div>

          <div className="px-3 py-2 text-left">
            <label className="block text-xs font-semibold uppercase text-stone-500">Guests</label>
            <input 
              type="text" 
              placeholder="2 adults" 
              className="w-full bg-transparent text-sm focus:outline-none font-medium text-stone-900 placeholder-stone-400"
            />
          </div>

          <button className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-3 px-6 rounded-xl transition shadow-md">
            Search
          </button>
        </div>
      </div>
    </div>
  );
};

export default Hero;
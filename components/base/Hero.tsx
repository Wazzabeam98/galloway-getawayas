'use client';

import React, { useState, useRef, useEffect } from 'react';

const Hero = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);

  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format guest summary text
  const totalGuests = adults + children;
  let guestSummary = 'Add guests';
  if (totalGuests > 0 || infants > 0 || pets > 0) {
    const parts = [];
    if (totalGuests > 0) parts.push(`${totalGuests} guest${totalGuests > 1 ? 's' : ''}`);
    if (infants > 0) parts.push(`${infants} infant${infants > 1 ? 's' : ''}`);
    if (pets > 0) parts.push(`${pets} pet${pets > 1 ? 's' : ''}`);
    guestSummary = parts.join(', ');
  }

  return (
    <div className="relative w-full h-[450px] md:h-[520px] flex items-center justify-center bg-stone-900 text-white overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-60"
        style={{ 
          backgroundImage: `url('https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?q=80&w=1600&auto=format&fit=crop')` 
        }}
      />

      {/* Content Container */}
      <div className="relative z-10 text-center max-w-4xl px-4 flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3 drop-shadow-md">
          Galloway Getaways
        </h1>
        <p className="text-lg md:text-xl font-medium mb-8 drop-shadow text-emerald-100">
          Book direct for our best rate guarantee & lower booking fees
        </p>

        {/* Search Bar Overlay */}
        <div className="w-full max-w-3xl bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl text-stone-800 grid grid-cols-1 md:grid-cols-4 gap-2 items-center relative">
          
          {/* Location Dropdown */}
          <div className="px-3 py-2 text-left border-b md:border-b-0 md:border-r border-stone-200">
            <label className="block text-xs font-semibold uppercase text-stone-500">Location</label>
            <select 
              defaultValue=""
              className="w-full bg-transparent text-sm focus:outline-none font-medium text-stone-900 cursor-pointer border-none p-0 focus:ring-0"
            >
              <option value="" disabled>Select Town / Area</option>
              <option value="all">All Dumfries & Galloway</option>
              <option value="kirkcudbright">Kirkcudbright</option>
              <option value="castle-douglas">Castle Douglas</option>
              <option value="gatehouse-of-fleet">Gatehouse of Fleet</option>
              <option value="dumfries">Dumfries</option>
              <option value="dalbeattie">Dalbeattie</option>
              <option value="newton-stewart">Newton Stewart</option>
              <option value="moffat">Moffat</option>
              <option value="stranraer">Stranraer</option>
            </select>
          </div>

          {/* Dates Input */}
          <div className="px-3 py-2 text-left border-b md:border-b-0 md:border-r border-stone-200">
            <label className="block text-xs font-semibold uppercase text-stone-500">Dates</label>
            <input 
              type="text" 
              placeholder="Check-in → Check-out" 
              className="w-full bg-transparent text-sm focus:outline-none font-medium text-stone-900 placeholder-stone-400"
            />
          </div>

          {/* Airbnb-style Guest Selector trigger */}
          <div className="relative px-3 py-2 text-left border-b md:border-b-0 md:border-r border-stone-200" ref={popoverRef}>
            <label className="block text-xs font-semibold uppercase text-stone-500">Who</label>
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="w-full text-left text-sm font-medium text-stone-900 focus:outline-none truncate"
            >
              <span className={guestSummary === 'Add guests' ? 'text-stone-400' : 'text-stone-900'}>
                {guestSummary}
              </span>
            </button>

            {/* Popup Menu */}
            {isOpen && (
              <div className="absolute right-0 md:-right-12 top-full mt-4 w-80 bg-white rounded-3xl p-6 shadow-2xl border border-stone-100 text-stone-900 z-50">
                {/* Adults */}
                <div className="flex items-center justify-between py-4 border-b border-stone-100">
                  <div>
                    <p className="font-semibold text-stone-900 text-base">Adults</p>
                    <p className="text-xs text-stone-500">Ages 13 or above</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setAdults(Math.max(0, adults - 1))}
                      disabled={adults === 0}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-stone-800 transition"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-medium">{adults}</span>
                    <button
                      type="button"
                      onClick={() => setAdults(adults + 1)}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 transition"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Children */}
                <div className="flex items-center justify-between py-4 border-b border-stone-100">
                  <div>
                    <p className="font-semibold text-stone-900 text-base">Children</p>
                    <p className="text-xs text-stone-500">Ages 2–12</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setChildren(Math.max(0, children - 1))}
                      disabled={children === 0}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-stone-800 transition"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-medium">{children}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setChildren(children + 1);
                        if (adults === 0) setAdults(1); // Auto-add 1 adult if child selected
                      }}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 transition"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Infants */}
                <div className="flex items-center justify-between py-4 border-b border-stone-100">
                  <div>
                    <p className="font-semibold text-stone-900 text-base">Infants</p>
                    <p className="text-xs text-stone-500">Under 2</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setInfants(Math.max(0, infants - 1))}
                      disabled={infants === 0}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-stone-800 transition"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-medium">{infants}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setInfants(infants + 1);
                        if (adults === 0) setAdults(1); // Auto-add 1 adult if infant selected
                      }}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 transition"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Pets */}
                <div className="flex items-center justify-between pt-4">
                  <div>
                    <p className="font-semibold text-stone-900 text-base">Pets</p>
                    <p className="text-xs text-stone-500">Bringing a service animal?</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setPets(Math.max(0, pets - 1))}
                      disabled={pets === 0}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed hover:border-stone-800 transition"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-medium">{pets}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPets(pets + 1);
                        if (adults === 0) setAdults(1); // Auto-add 1 adult if pet selected
                      }}
                      className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 transition"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Search Button */}
          <button className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-3 px-6 rounded-xl transition shadow-md">
            Search
          </button>
        </div>
      </div>
    </div>
  );
};

export default Hero;
'use client';

import React, { useState, useRef, useEffect } from 'react';

const Hero = () => {
  // Popover States
  const [activePopover, setActivePopover] = useState<'when' | 'who' | null>(null);

  // Guest State (Who)
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);

  // When State (Dates vs Flexible)
  const [dateTab, setDateTab] = useState<'dates' | 'flexible'>('dates');
  const [stayDuration, setStayDuration] = useState<'weekend' | 'week' | 'month'>('week');
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  
  // Datepicker simple mock state
  const [selectedDateRange, setSelectedDateRange] = useState<string>('');

  const heroRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (heroRef.current && !heroRef.current.contains(event.target as Node)) {
        setActivePopover(null);
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

  // Format date summary text
  let whenSummary = 'Add dates';
  if (dateTab === 'dates' && selectedDateRange) {
    whenSummary = selectedDateRange;
  } else if (dateTab === 'flexible') {
    if (selectedMonths.length > 0) {
      whenSummary = `A ${stayDuration} in ${selectedMonths.join(', ')}`;
    } else {
      whenSummary = `Any ${stayDuration}`;
    }
  }

  const toggleMonth = (month: string) => {
    if (selectedMonths.includes(month)) {
      setSelectedMonths(selectedMonths.filter((m) => m !== month));
    } else {
      setSelectedMonths([...selectedMonths, month]);
    }
  };

  const monthsList = [
    { name: 'August', year: '2026' },
    { name: 'September', year: '2026' },
    { name: 'October', year: '2026' },
    { name: 'November', year: '2026' },
    { name: 'December', year: '2026' },
    { name: 'January', year: '2027' },
  ];

  return (
    <div className="relative w-full h-[480px] md:h-[540px] flex items-center justify-center bg-stone-900 text-white overflow-hidden" ref={heroRef}>
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-60"
        style={{ 
          backgroundImage: `url('https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?q=80&w=1600&auto=format&fit=crop')` 
        }}
      />

      {/* Content Container */}
      <div className="relative z-10 text-center max-w-5xl px-4 flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3 drop-shadow-md">
          Galloway Getaways
        </h1>
        <p className="text-lg md:text-xl font-medium mb-8 drop-shadow text-emerald-100">
          Book direct for our best rate guarantee & lower booking fees
        </p>

        {/* Airbnb-Style Search Bar */}
        <div className="w-full max-w-4xl bg-white rounded-full p-2 shadow-2xl text-stone-800 grid grid-cols-1 md:grid-cols-12 gap-1 items-center relative">
          
          {/* WHERE Input */}
          <div className="md:col-span-4 px-6 py-3 text-left hover:bg-stone-100/80 rounded-full transition cursor-pointer">
            <label className="block text-xs font-bold tracking-wider uppercase text-stone-700">Where</label>
            <select 
              defaultValue=""
              className="w-full bg-transparent text-sm font-medium text-stone-800 focus:outline-none cursor-pointer border-none p-0 focus:ring-0 truncate"
            >
              <option value="" disabled>Search destinations</option>
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

          <div className="hidden md:block h-8 w-[1px] bg-stone-200 justify-self-center"></div>

          {/* WHEN Input & Popover Trigger */}
          <div 
            onClick={() => setActivePopover(activePopover === 'when' ? null : 'when')}
            className={`md:col-span-4 px-6 py-3 text-left rounded-full transition cursor-pointer ${
              activePopover === 'when' ? 'bg-white shadow-md' : 'hover:bg-stone-100/80'
            }`}
          >
            <label className="block text-xs font-bold tracking-wider uppercase text-stone-700">When</label>
            <p className={`text-sm font-medium truncate ${whenSummary === 'Add dates' ? 'text-stone-400' : 'text-stone-900'}`}>
              {whenSummary}
            </p>
          </div>

          <div className="hidden md:block h-8 w-[1px] bg-stone-200 justify-self-center"></div>

          {/* WHO Input & Popover Trigger */}
          <div 
            onClick={() => setActivePopover(activePopover === 'who' ? null : 'who')}
            className={`md:col-span-3 px-6 py-3 text-left rounded-full transition cursor-pointer ${
              activePopover === 'who' ? 'bg-white shadow-md' : 'hover:bg-stone-100/80'
            }`}
          >
            <label className="block text-xs font-bold tracking-wider uppercase text-stone-700">Who</label>
            <p className={`text-sm font-medium truncate ${guestSummary === 'Add guests' ? 'text-stone-400' : 'text-stone-900'}`}>
              {guestSummary}
            </p>
          </div>

          {/* SEARCH BUTTON */}
          <div className="md:col-span-1 flex justify-end p-1">
            <button className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full p-4 md:p-3 flex items-center justify-center transition shadow-md w-full md:w-auto">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>

          {/* =========================================
              WHEN POPOVER (Calendar + Flexible Tabs)
             ========================================= */}
          {activePopover === 'when' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-4 w-full max-w-2xl bg-white rounded-3xl p-6 shadow-2xl border border-stone-100 text-stone-900 z-50">
              {/* Tab Switcher */}
              <div className="flex justify-center mb-6">
                <div className="bg-stone-100 p-1 rounded-full flex gap-1 border border-stone-200">
                  <button
                    type="button"
                    onClick={() => setDateTab('dates')}
                    className={`px-8 py-2 rounded-full text-sm font-semibold transition ${
                      dateTab === 'dates' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    Dates
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateTab('flexible')}
                    className={`px-8 py-2 rounded-full text-sm font-semibold transition ${
                      dateTab === 'flexible' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    Flexible
                  </button>
                </div>
              </div>

              {/* DATES TAB CONTENT */}
              {dateTab === 'dates' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-8 text-center">
                    <div>
                      <h4 className="font-bold text-stone-800 mb-2">August 2026</h4>
                      <div className="grid grid-cols-7 gap-1 text-xs text-stone-500 font-medium mb-1">
                        <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
                      </div>
                      <div className="grid grid-cols-7 gap-1 text-sm font-medium text-stone-700">
                        <span className="col-start-6 text-stone-300">1</span>
                        <span className="text-stone-300">2</span>
                        {[...Array(29)].map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setSelectedDateRange(`Aug ${i + 3} - Aug ${i + 7}`)}
                            className="p-1.5 hover:bg-emerald-50 hover:text-emerald-700 rounded-full transition"
                          >
                            {i + 3}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-stone-800 mb-2">September 2026</h4>
                      <div className="grid grid-cols-7 gap-1 text-xs text-stone-500 font-medium mb-1">
                        <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
                      </div>
                      <div className="grid grid-cols-7 gap-1 text-sm font-medium text-stone-700">
                        <span className="col-start-2">1</span>
                        {[...Array(29)].map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setSelectedDateRange(`Sep ${i + 2} - Sep ${i + 6}`)}
                            className="p-1.5 hover:bg-emerald-50 hover:text-emerald-700 rounded-full transition"
                          >
                            {i + 2}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* FLEXIBLE TAB CONTENT */}
              {dateTab === 'flexible' && (
                <div className="space-y-6 text-center">
                  {/* How long */}
                  <div>
                    <h4 className="text-base font-bold text-stone-900 mb-3">How long would you like to stay?</h4>
                    <div className="flex justify-center gap-3">
                      {(['weekend', 'week', 'month'] as const).map((duration) => (
                        <button
                          key={duration}
                          type="button"
                          onClick={() => setStayDuration(duration)}
                          className={`px-5 py-2 rounded-full border text-sm font-medium capitalize transition ${
                            stayDuration === duration
                              ? 'border-stone-900 bg-stone-900 text-white'
                              : 'border-stone-300 text-stone-700 hover:border-stone-900'
                          }`}
                        >
                          {duration}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* When do you want to go */}
                  <div>
                    <h4 className="text-base font-bold text-stone-900 mb-3">When do you want to go?</h4>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      {monthsList.map((m) => {
                        const isSelected = selectedMonths.includes(m.name);
                        return (
                          <button
                            key={m.name}
                            type="button"
                            onClick={() => toggleMonth(m.name)}
                            className={`p-3 rounded-2xl border text-center transition flex flex-col items-center justify-center gap-2 ${
                              isSelected
                                ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-700'
                                : 'border-stone-200 hover:border-stone-400 text-stone-800'
                            }`}
                          >
                            <svg className="w-6 h-6 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <div>
                              <p className="text-xs font-bold">{m.name}</p>
                              <p className="text-[10px] text-stone-500">{m.year}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =========================================
              WHO POPOVER (Guests)
             ========================================= */}
          {activePopover === 'who' && (
            <div className="absolute right-0 top-full mt-4 w-80 bg-white rounded-3xl p-6 shadow-2xl border border-stone-100 text-stone-900 z-50">
              {/* Adults */}
              <div className="flex items-center justify-between py-3 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-stone-900 text-sm">Adults</p>
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
                  <span className="w-4 text-center text-sm font-medium">{adults}</span>
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
              <div className="flex items-center justify-between py-3 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-stone-900 text-sm">Children</p>
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
                  <span className="w-4 text-center text-sm font-medium">{children}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setChildren(children + 1);
                      if (adults === 0) setAdults(1);
                    }}
                    className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 transition"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Infants */}
              <div className="flex items-center justify-between py-3 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-stone-900 text-sm">Infants</p>
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
                  <span className="w-4 text-center text-sm font-medium">{infants}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setInfants(infants + 1);
                      if (adults === 0) setAdults(1);
                    }}
                    className="w-8 h-8 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 transition"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Pets */}
              <div className="flex items-center justify-between pt-3">
                <div>
                  <p className="font-semibold text-stone-900 text-sm">Pets</p>
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
                  <span className="w-4 text-center text-sm font-medium">{pets}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPets(pets + 1);
                      if (adults === 0) setAdults(1);
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
      </div>
    </div>
  );
};

export default Hero;
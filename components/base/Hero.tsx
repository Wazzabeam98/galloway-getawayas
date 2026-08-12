'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { format, addMonths, isSameDay } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

const durations = ['weekend', 'week', 'month'];
const futureMonths = [...Array(12)].map((_, i) => addMonths(new Date(), i));

export default function Hero() {
  const [activePopover, setActivePopover] = useState<'where' | 'when' | 'who' | null>(null);

  // Search State
  const [location, setLocation] = useState('');
  const [dateTab, setDateTab] = useState<'dates' | 'flexible'>('dates');
  
  const today = new Date();
  const [dateRange, setDateRange] = useState<Range>({
    startDate: today,
    endDate: today,
    key: 'selection',
  });

  const [stayDuration, setStayDuration] = useState('week');
  const [selectedMonths, setSelectedMonths] = useState<Date[]>([]);

  // Guest State
  const [adults, setAdults] = useState(0);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);

  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (heroRef.current && !heroRef.current.contains(event.target as Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectDates = (ranges: RangeKeyDict) => {
    setDateRange(ranges.selection);
    if (
      ranges.selection.startDate &&
      ranges.selection.endDate &&
      !isSameDay(ranges.selection.startDate, ranges.selection.endDate)
    ) {
      setActivePopover(null);
    }
  };

  const toggleMonth = (month: Date) => {
    if (selectedMonths.some((m) => isSameDay(m, month))) {
      setSelectedMonths(selectedMonths.filter((m) => !isSameDay(m, month)));
    } else {
      setSelectedMonths([...selectedMonths, month]);
    }
  };

  const totalGuests = adults + children;
  let guestSummary = 'Add guests';
  if (totalGuests > 0 || infants > 0 || pets > 0) {
    const parts = [];
    if (totalGuests > 0) parts.push(`${totalGuests} guest${totalGuests > 1 ? 's' : ''}`);
    if (infants > 0) parts.push(`${infants} infant${infants > 1 ? 's' : ''}`);
    if (pets > 0) parts.push(`${pets} pet${pets > 1 ? 's' : ''}`);
    guestSummary = parts.join(', ');
  }

  let whenSummary = 'Add dates';
  if (
    dateTab === 'dates' &&
    dateRange.startDate &&
    dateRange.endDate &&
    !isSameDay(dateRange.startDate, dateRange.endDate)
  ) {
    whenSummary = `${format(dateRange.startDate, 'd MMM')} - ${format(dateRange.endDate, 'd MMM')}`;
  } else if (dateTab === 'flexible') {
    if (selectedMonths.length > 0) {
      const sortedMonths = [...selectedMonths].sort((a, b) => a.getTime() - b.getTime());
      whenSummary = `A ${stayDuration} in ${format(sortedMonths[0], 'MMM')}${sortedMonths.length > 1 ? '...' : ''}`;
    } else {
      whenSummary = `Any ${stayDuration}`;
    }
  }

  return (
    <div
      className="relative z-40 w-full h-[460px] md:h-[500px] flex items-center justify-center bg-stone-900 text-white overflow-visible"
      ref={heroRef}
    >
      {/* Background Image */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-60"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?q=80&w=1600&auto=format&fit=crop')`,
          }}
        />
      </div>

      {/* Content Container */}
      <div className="relative z-10 text-center max-w-5xl px-4 flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3 drop-shadow-md">
          Galloway Getaways
        </h1>
        <p className="text-lg md:text-xl font-medium mb-8 drop-shadow text-emerald-100">
          Book direct for our best rate guarantee & lower booking fees
        </p>

        {/* Search Bar Container */}
        <div className="w-full max-w-3xl bg-white rounded-full p-1.5 shadow-2xl text-stone-800 flex items-center relative border border-stone-100">
          
          {/* WHERE */}
          <div
            onClick={() => setActivePopover('where')}
            className={`flex-grow px-6 py-2.5 text-left rounded-full transition cursor-pointer ${
              activePopover === 'where' ? 'bg-white shadow-md' : 'hover:bg-stone-100'
            }`}
          >
            <label className="block text-[10px] font-bold tracking-wider uppercase text-stone-700 cursor-pointer">
              Where
            </label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-transparent text-sm font-medium text-stone-900 focus:outline-none cursor-pointer border-none p-0 focus:ring-0 truncate"
            >
              <option value="">Search destinations</option>
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

          <div className="h-8 w-[1px] bg-stone-200"></div>

          {/* WHEN */}
          <div
            onClick={() => setActivePopover('when')}
            className={`flex-grow px-6 py-2.5 text-left rounded-full transition cursor-pointer ${
              activePopover === 'when' ? 'bg-white shadow-md' : 'hover:bg-stone-100'
            }`}
          >
            <label className="block text-[10px] font-bold tracking-wider uppercase text-stone-700 cursor-pointer">
              When
            </label>
            <p
              className={`text-sm font-medium truncate ${
                whenSummary === 'Add dates' ? 'text-stone-400' : 'text-stone-900'
              }`}
            >
              {whenSummary}
            </p>
          </div>

          <div className="h-8 w-[1px] bg-stone-200"></div>

          {/* WHO */}
          <div
            onClick={() => setActivePopover('who')}
            className={`flex-grow px-6 py-2.5 text-left rounded-full transition cursor-pointer ${
              activePopover === 'who' ? 'bg-white shadow-md' : 'hover:bg-stone-100'
            }`}
          >
            <label className="block text-[10px] font-bold tracking-wider uppercase text-stone-700 cursor-pointer">
              Who
            </label>
            <p
              className={`text-sm font-medium truncate ${
                guestSummary === 'Add guests' ? 'text-stone-400' : 'text-stone-900'
              }`}
            >
              {guestSummary}
            </p>
          </div>

          {/* Search Button */}
          <div className="flex justify-end p-0.5">
            <button className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full p-3.5 flex items-center justify-center transition shadow-md">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>
          </div>

          {/* =========================================
              WHEN POPOVER (Compact Airbnb Calendar)
             ========================================= */}
          {activePopover === 'when' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+10px)] bg-white rounded-3xl p-5 shadow-2xl border border-stone-200 text-stone-900 z-50 min-w-[620px]">
              
              {/* Tab Switcher */}
              <div className="flex justify-center mb-4">
                <div className="bg-stone-100 p-1 rounded-full flex gap-1 border border-stone-200">
                  <button
                    type="button"
                    onClick={() => setDateTab('dates')}
                    className={`px-6 py-1.5 rounded-full text-xs font-semibold transition ${
                      dateTab === 'dates' ? 'bg-white shadow text-stone-900' : 'text-stone-600'
                    }`}
                  >
                    Dates
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateTab('flexible')}
                    className={`px-6 py-1.5 rounded-full text-xs font-semibold transition ${
                      dateTab === 'flexible' ? 'bg-white shadow text-stone-900' : 'text-stone-600'
                    }`}
                  >
                    Flexible
                  </button>
                </div>
              </div>

              {/* DATES TAB */}
              {dateTab === 'dates' && (
                <div className="airbnb-compact-calendar flex justify-center">
                  <DateRangePicker
                    ranges={[dateRange]}
                    onChange={handleSelectDates}
                    months={2}
                    direction="horizontal"
                    showDateDisplay={false}
                    moveRangeOnFirstSelection={false}
                    showMonthAndYearPickers={false}
                    minDate={new Date()}
                    rangeColors={['#047857']}
                    weekStartsOn={1}
                    className="text-xs"
                  />
                </div>
              )}

              {/* FLEXIBLE TAB */}
              {dateTab === 'flexible' && (
                <div className="space-y-4 text-center max-w-md mx-auto">
                  <div>
                    <h4 className="text-sm font-bold text-stone-900 mb-2">
                      How long would you like to stay?
                    </h4>
                    <div className="flex justify-center gap-2">
                      {durations.map((duration) => (
                        <button
                          key={duration}
                          type="button"
                          onClick={() => setStayDuration(duration)}
                          className={`px-4 py-1.5 rounded-full border text-xs font-medium capitalize transition ${
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

                  <div>
                    <h4 className="text-sm font-bold text-stone-900 mb-2">When do you want to go?</h4>
                    <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1">
                      {futureMonths.map((month, i) => {
                        const isSelected = selectedMonths.some((m) => isSameDay(m, month));
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleMonth(month)}
                            className={`p-2 rounded-xl border transition flex flex-col items-center justify-center ${
                              isSelected
                                ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-700'
                                : 'border-stone-200 hover:border-stone-400'
                            }`}
                          >
                            <svg
                              className="w-4 h-4 text-emerald-600 mb-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                            <p className="text-[11px] font-bold">{format(month, 'MMMM')}</p>
                            <p className="text-[9px] text-stone-500">{format(month, 'yyyy')}</p>
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
              WHO POPOVER
             ========================================= */}
          {activePopover === 'who' && (
            <div className="absolute right-0 top-[calc(100%+10px)] w-80 bg-white rounded-3xl p-5 shadow-2xl border border-stone-200 text-stone-900 z-50">
              <div className="flex items-center justify-between py-2.5 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-sm">Adults</p>
                  <p className="text-xs text-stone-500">Ages 13 or above</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAdults(Math.max(0, adults - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-medium">{adults}</span>
                  <button
                    type="button"
                    onClick={() => setAdults(adults + 1)}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-sm">Children</p>
                  <p className="text-xs text-stone-500">Ages 2–12</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setChildren(Math.max(0, children - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
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
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-stone-100">
                <div>
                  <p className="font-semibold text-sm">Infants</p>
                  <p className="text-xs text-stone-500">Under 2</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setInfants(Math.max(0, infants - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
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
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <div>
                  <p className="font-semibold text-sm">Pets</p>
                  <p className="text-xs text-stone-500">Bringing a service animal?</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPets(Math.max(0, pets - 1))}
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800 disabled:opacity-30"
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
                    className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-600 hover:border-stone-800"
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
}